import {Array, Boolean, Context, Effect, Equal, Layer, Match, Option, Record, Schema, Stream, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'
import {Reactivity} from 'effect/reactivity'
import type {SqlError} from 'effect/sql'
import {Migrator, SqlClient, SqlModel, SqlSchema} from 'effect/sql'

import type {UserId} from '@deslop/runtime/shared/auth'
import {listEvents} from '@deslop/runtime/shared/list'

import {Extractor} from './lib/extraction.ts'
import {passText} from './lib/pkpass.ts'
import {Places} from './lib/places.ts'
import {Timetable} from './lib/timetable.ts'
import {migrations} from './migrations.ts'

import {byStart, instantOf, journeysOf, upsert} from '#services/bookings/lib/utils.ts'
import type {Booking, BookingSource, ExtractedItem, LocalTime} from '#services/bookings/schema.ts'
import {BookingId, BookingsError, Flight, Stay, Train} from '#services/bookings/schema.ts'

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

function asStorageBookingsError(cause: SqlError.SqlError | Schema.SchemaError) {
	return BookingsError.make({cause, message: 'The trips storage failed.'})
}

const asBookingsError = Effect.mapError(asStorageBookingsError)

export class Bookings extends Context.Service<Bookings>()('@deslop/trips/services/bookings/service/Bookings', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const places = yield* Places
		const timetable = yield* Timetable
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

		// A booking lives in one of three tables; missing from the others is expected, not a failed lookup.
		const findFlight = SqlSchema.findOneOption({
			Request: BookingId,
			Result: Flight,
			execute: id => sql`SELECT * FROM ${sql(Flight.table)} WHERE id = ${id}`
		})
		const findTrain = SqlSchema.findOneOption({
			Request: BookingId,
			Result: Train,
			execute: id => sql`SELECT * FROM ${sql(Train.table)} WHERE id = ${id}`
		})
		const findStay = SqlSchema.findOneOption({
			Request: BookingId,
			Result: Stay,
			execute: id => sql`SELECT * FROM ${sql(Stay.table)} WHERE id = ${id}`
		})
		const find = Effect.fnUntraced(function* (id: BookingId) {
			const flight: Option.Option<Booking> = yield* findFlight(id)
			if (Option.isSome(flight)) return flight
			const train: Option.Option<Booking> = yield* findTrain(id)
			if (Option.isSome(train)) return train
			const stay: Option.Option<Booking> = yield* findStay(id)
			return stay
		})

		const update = pipe(
			Match.type<Booking>(),
			Match.tag('flight', flights.updateVoid),
			Match.tag('train', trains.updateVoid),
			Match.tag('stay', stays.updateVoid),
			Match.exhaustive
		)

		const watch = pipe(
			sql.reactive(['bookings'], listAll),
			Stream.mapError(asStorageBookingsError),
			Stream.withSpan('Bookings.watch', {attributes: {'rpc.stream': true}})
		)

		// Airports and stations resolve from their datasets, so a time reads in the right zone and a ride has coordinates.
		const resolve = Effect.fnUntraced(function* (item: ExtractedItem) {
			const base = {confirmation: item.confirmation, id: BookingId.make(yield* random.uuidV4()), status: item.status}
			if (item.kind === 'flight') {
				const from = yield* places.airport(item.from)
				const to = yield* places.airport(item.to)
				return Flight.make({
					...base,
					airline: item.airlineName,
					airlineCode: item.airlineCode,
					arrives: yield* at(item.arrival, to.timeZone),
					boardingAt: yield* Effect.transposeOption(Option.map(item.boarding, boarding => at(boarding, from.timeZone))),
					boardingGroup: item.boardingGroup,
					departs: yield* at(item.departure, from.timeZone),
					from,
					live: Option.none(),
					number: item.flightNumber,
					seat: item.seat,
					to
				})
			}
			if (item.kind === 'train') {
				return Train.make({
					...base,
					...(yield* timetable.resolve(item)),
					coach: item.coach,
					live: Option.none(),
					number: item.trainNumber,
					seat: item.seat
				})
			}
			return Stay.make({
				...base,
				checkIn: yield* at(item.checkIn, item.timeZone),
				checkOut: yield* at(item.checkOut, item.timeZone),
				name: item.name,
				place: {
					address: Option.some(item.address),
					city: Option.some(item.city),
					code: Option.none(),
					latitude: Option.none(),
					longitude: Option.none(),
					name: item.name,
					timeZone: item.timeZone
				}
			})
		})

		// Every segment merges into the bookings as they are inside the caller's write transaction, so two saves never lose each other's merge.
		const merge = Effect.fnUntraced(function* (incoming: readonly Booking[]) {
			const current = yield* listAll
			const stored = Record.fromIterableBy(current, booking => booking.id)
			yield* Effect.forEach(
				upsert(current, incoming),
				booking =>
					pipe(
						stored,
						Record.get(booking.id),
						Option.match({
							onNone: () => insert(booking),
							onSome: before =>
								pipe(
									before,
									Equal.equals(booking),
									Boolean.match({onFalse: () => update(booking), onTrue: () => Effect.void})
								)
						})
					),
				{concurrency: 1, discard: true}
			)
		})

		return {
			// What the phone watches: the whole list first, then only what changed, after each commit.
			events: Stream.withSpan(
				listEvents(watch, booking => booking.id),
				'Bookings.events',
				{attributes: {'rpc.stream': true}}
			),
			find: Effect.fn('Bookings.find')((id: BookingId) => asBookingsError(find(id))),
			list: pipe(listAll, asBookingsError, Effect.withSpan('Bookings.list')),
			passText,
			remove: Effect.fn('Bookings.remove')(function* (id: BookingId) {
				yield* Effect.annotateCurrentSpan('bookingId', id)
				yield* pipe(
					Effect.gen(function* () {
						yield* pipe(
							journeysOf(yield* listAll),
							Array.findFirst(legs => Array.some(legs, leg => leg.id === id)),
							Option.match({
								onNone: () => Effect.void,
								onSome: journey =>
									Effect.forEach(
										journey,
										leg =>
											Effect.all([flights.delete(leg.id), trains.delete(leg.id), stays.delete(leg.id)], {
												concurrency: 1,
												discard: true
											}),
										{concurrency: 1, discard: true}
									)
							})
						)
					}),
					Reactivity.mutation(['bookings']),
					sql.withTransaction,
					Effect.mapError(cause =>
						BookingsError.make({cause, message: 'The journey was not deleted. No legs were removed.'})
					)
				)
			}, withReactivity),
			// The newer state replaces the one it was made from, unless the booking changed or left meanwhile.
			replace: Effect.fn('Bookings.replace')(function* (before: Booking, after: Booking) {
				yield* Effect.annotateCurrentSpan('bookingId', before.id)
				yield* pipe(
					find(before.id),
					Effect.flatMap(current =>
						pipe(
							current,
							Option.exists(row => Equal.equals(row, before)),
							Boolean.match({onFalse: () => Effect.void, onTrue: () => update(after)})
						)
					),
					Reactivity.mutation(['bookings']),
					sql.withTransaction,
					asBookingsError
				)
			}, withReactivity),
			save: Effect.fn('Bookings.save')(function* (userId: UserId, source: BookingSource) {
				yield* Effect.annotateCurrentSpan('userId', userId)
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
						cause: issues,
						message: 'Some ticket segments could not be resolved. Check their places and times; no segments were saved.'
					})
				}
				yield* pipe(
					merge(Array.getSuccesses(resolved)),
					Reactivity.mutation(['bookings']),
					sql.withTransaction,
					asBookingsError
				)
			}, withReactivity),
			// What the push rounds follow: the whole list again after each commit.
			watch
		}
	})
}) {
	// The tables this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({loader: Migrator.fromRecord(migrations), table: 'bookings_migrations'})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}

// Place lookups and extraction are the bookings' own internals; tests provide stand-ins to `Bookings.layer` instead.
export const layerBookings = Layer.provide(
	Bookings.layer,
	Layer.mergeAll(Places.layer, Extractor.layer, Layer.provide(Timetable.layer, Places.layer))
)
