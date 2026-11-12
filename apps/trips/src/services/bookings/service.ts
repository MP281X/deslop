import {Array, Boolean, Context, Effect, Equal, Layer, Match, Option, Schema, Stream, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'
import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlModel, SqlSchema} from 'effect/sql'

import {listEvents} from '@deslop/runtime/shared/list'

import {Extractor} from './lib/extraction.ts'
import {Places} from './lib/places.ts'

import {byStart, instantOf, upsert} from '#services/bookings/lib/utils.ts'
import type {Booking, BookingId, BookingSource, ExtractedItem, LocalTime} from '#services/bookings/schema.ts'
import {BookingsError, Flight, Place, Stay, Train} from '#services/bookings/schema.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly bookings: never
	}
}

function at(time: LocalTime, timeZone: string) {
	return Option.match(instantOf(time, timeZone), {
		onNone: () => BookingsError.make({message: `The time ${time} could not be read.`}),
		onSome: Effect.succeed
	})
}

function storageFailure(cause: unknown) {
	return BookingsError.make({cause, message: 'The trips storage failed.'})
}

const storageFailed = Effect.mapError(storageFailure)

export class Bookings extends Context.Service<Bookings>()('@deslop/trips/services/bookings/service/Bookings', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const places = yield* Places
		const extractor = yield* Extractor
		const random = yield* SecureRandom.SecureRandom
		// Writes tell this Reactivity of their commits, so callers need none of their own.
		const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)

		const flights = yield* SqlModel.makeRepository(Flight, {
			idColumn: 'id',
			spanPrefix: 'Flights',
			tableName: Flight.table
		})
		const trains = yield* SqlModel.makeRepository(Train, {idColumn: 'id', spanPrefix: 'Trains', tableName: Train.table})
		const stays = yield* SqlModel.makeRepository(Stay, {idColumn: 'id', spanPrefix: 'Stays', tableName: Stay.table})

		const listFlights = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Flight,
			execute: () => sql`SELECT * FROM ${sql(Flight.table)}`
		})
		const listTrains = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Train,
			execute: () => sql`SELECT * FROM ${sql(Train.table)}`
		})
		const listStays = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Stay,
			execute: () => sql`SELECT * FROM ${sql(Stay.table)}`
		})

		// Soonest first, live delays included, as the phone lists them.
		const listAll = Effect.map(Effect.all([listFlights(), listTrains(), listStays()], {concurrency: 1}), kinds =>
			Array.sort([...kinds[0], ...kinds[1], ...kinds[2]], byStart)
		)

		const insert = pipe(
			Match.type<Booking>(),
			Match.tag('flight', flights.insertVoid),
			Match.tag('train', trains.insertVoid),
			Match.tag('stay', stays.insertVoid),
			Match.exhaustive
		)

		const update = pipe(
			Match.type<Booking>(),
			Match.tag('flight', flights.updateVoid),
			Match.tag('train', trains.updateVoid),
			Match.tag('stay', stays.updateVoid),
			Match.exhaustive
		)

		const changes = Stream.mapError(sql.reactive(['bookings'], listAll), storageFailure)

		// Saved with its zone; an unplaced station of an Italian operator falls back to Italy's, another railway's fails the save.
		const stationFor = Effect.fnUntraced(function* (name: string, operator: Train['operator']) {
			const found = yield* Effect.option(places.station(name))
			const timeZone = yield* Option.match(
				Option.orElse(
					Option.flatMap(found, place => Option.fromUndefinedOr(place.timeZone)),
					() => Option.liftPredicate('Europe/Rome', () => operator !== 'other')
				),
				{
					onNone: () => BookingsError.make({message: `The station ${name} could not be placed.`}),
					onSome: Effect.succeed
				}
			)
			return {...Option.getOrElse(found, () => Place.make({name})), timeZone}
		})

		// Airports and stations resolve from their datasets, so a time reads in the right zone and a ride has coordinates.
		const resolve = Effect.fnUntraced(function* (item: ExtractedItem) {
			const base = {
				confirmation: Option.fromUndefinedOr(item.confirmation),
				id: yield* random.uuidV4(),
				status: item.status
			}
			if (item.kind === 'flight') {
				const from = yield* places.airport(item.from)
				const to = yield* places.airport(item.to)
				return Flight.make({
					...base,
					airline: item.airlineName,
					airlineCode: item.airlineCode,
					arrives: yield* at(item.arrival, to.timeZone),
					boardingAt: yield* Effect.transposeOption(
						Option.map(Option.fromUndefinedOr(item.boarding), boarding => at(boarding, from.timeZone))
					),
					boardingGroup: Option.fromUndefinedOr(item.boardingGroup),
					departs: yield* at(item.departure, from.timeZone),
					from,
					live: Option.none(),
					number: item.flightNumber,
					seat: Option.fromUndefinedOr(item.seat),
					to
				})
			}
			if (item.kind === 'train') {
				const from = yield* stationFor(item.from, item.operator)
				const to = yield* stationFor(item.to, item.operator)
				return Train.make({
					...base,
					arrives: yield* at(item.arrival, to.timeZone),
					coach: Option.fromUndefinedOr(item.coach),
					departs: yield* at(item.departure, from.timeZone),
					from,
					live: Option.none(),
					number: item.trainNumber,
					operator: item.operator,
					operatorName: item.operatorName,
					seat: Option.fromUndefinedOr(item.seat),
					to
				})
			}
			return Stay.make({
				...base,
				checkIn: yield* at(item.checkIn, item.timeZone),
				checkOut: yield* at(item.checkOut, item.timeZone),
				name: item.name,
				place: {address: item.address, city: item.city, name: item.name, timeZone: item.timeZone}
			})
		})

		// Every segment merges into the bookings as they are inside the write, so two saves never lose each other's merge.
		const merge = Effect.fnUntraced(function* (incoming: readonly Booking[]) {
			const current = yield* listAll
			yield* Effect.forEach(
				Array.filter(upsert(current, incoming), booking => !Array.contains(current, booking)),
				booking =>
					Boolean.match(
						Array.some(current, item => item.id === booking.id),
						{onFalse: () => insert(booking), onTrue: () => update(booking)}
					),
				{concurrency: 1, discard: true}
			)
		})

		return {
			// What the push rounds follow: the whole list again after each commit.
			changes,
			// What the phone watches: the whole list first, then only what changed, after each commit.
			events: listEvents(changes),
			list: storageFailed(listAll),
			remove: Effect.fn('Bookings.remove')(function* (id: BookingId) {
				yield* pipe(
					Effect.all([flights.delete(id), trains.delete(id), stays.delete(id)], {concurrency: 1, discard: true}),
					Reactivity.mutation(['bookings']),
					sql.withTransaction,
					storageFailed
				)
			}, withReactivity),
			// The newer state replaces the one it was made from, unless the booking changed or left meanwhile.
			replace: Effect.fn('Bookings.replace')(function* (before: Booking, after: Booking) {
				yield* pipe(
					listAll,
					Effect.flatMap(current =>
						Boolean.match(
							Array.some(current, row => Equal.equals(row, before)),
							{onFalse: () => Effect.void, onTrue: () => update(after)}
						)
					),
					Reactivity.mutation(['bookings']),
					sql.withTransaction,
					storageFailed
				)
			}, withReactivity),
			save: Effect.fn('Bookings.save')(function* (userId: string, source: BookingSource) {
				const items = yield* extractor.read(userId, source)
				if (Array.isReadonlyArrayEmpty(items)) {
					return yield* BookingsError.make({
						message: 'No booking found. Copy a confirmation or boarding pass and try again.'
					})
				}
				// Every segment or none, so a ticket is never half saved; the failure names the place to fix.
				const resolved = yield* Effect.forEach(items, item => Effect.result(resolve(item)), {concurrency: 1})
				const issues = Array.getFailures(resolved)
				if (Array.isReadonlyArrayNonEmpty(issues)) {
					return yield* BookingsError.make({
						message: Array.join(
							Array.map(issues, error => error.message),
							' '
						)
					})
				}
				yield* pipe(
					merge(Array.getSuccesses(resolved)),
					Reactivity.mutation(['bookings']),
					sql.withTransaction,
					storageFailed
				)
			}, withReactivity)
		}
	})
}) {
	// The tables this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({
			loader: Migrator.fromRecord({
				'0001_bookings': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`
						CREATE TABLE flights (
							id TEXT PRIMARY KEY,
							status TEXT NOT NULL,
							airline TEXT NOT NULL,
							airlineCode TEXT NOT NULL,
							number TEXT NOT NULL,
							"from" TEXT NOT NULL,
							"to" TEXT NOT NULL,
							departs INTEGER NOT NULL,
							arrives INTEGER NOT NULL,
							boardingAt INTEGER,
							boardingGroup TEXT,
							confirmation TEXT,
							seat TEXT,
							live TEXT
						) STRICT
					`
					yield* sql`
						CREATE TABLE trains (
							id TEXT PRIMARY KEY,
							status TEXT NOT NULL,
							operator TEXT NOT NULL,
							operatorName TEXT NOT NULL,
							number TEXT NOT NULL,
							"from" TEXT NOT NULL,
							"to" TEXT NOT NULL,
							departs INTEGER NOT NULL,
							arrives INTEGER NOT NULL,
							coach TEXT,
							confirmation TEXT,
							seat TEXT,
							live TEXT
						) STRICT
					`
					yield* sql`
						CREATE TABLE stays (
							id TEXT PRIMARY KEY,
							status TEXT NOT NULL,
							name TEXT NOT NULL,
							place TEXT NOT NULL,
							checkIn INTEGER NOT NULL,
							checkOut INTEGER NOT NULL,
							confirmation TEXT
						) STRICT
					`
				})
			}),
			table: 'bookings_migrations'
		})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}

// Place lookups and extraction are the bookings' own internals; tests provide stand-ins to `Bookings.layer` instead.
export const layerBookings = Layer.provide(Bookings.layer, Layer.mergeAll(Places.layer, Extractor.layer))
