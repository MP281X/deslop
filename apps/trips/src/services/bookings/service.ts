import {Array, Boolean, Context, DateTime, Effect, Equal, Layer, Option, Record, Schema, Stream, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'
import {Reactivity} from 'effect/reactivity'
import type {SqlError} from 'effect/sql'
import {Migrator, SqlClient, SqlModel, SqlSchema} from 'effect/sql'

import type {UserId} from '@deslop/runtime/shared/auth'
import {listEvents} from '@deslop/runtime/shared/list'

import {Extractor} from './lib/extraction.ts'
import {passText} from './lib/pkpass.ts'
import {Places} from './lib/places.ts'
import {migrations} from './migrations.ts'

import {byDeparture, instantOf, upsert} from '#services/bookings/lib/utils.ts'
import type {BookingList, BookingSource, ExtractedItem, LocalTime} from '#services/bookings/schema.ts'
import {BookingId, BookingsError, Flight} from '#services/bookings/schema.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly bookings: never
	}
}

function at(time: LocalTime, timeZone: string) {
	return Option.match(instantOf(time, Option.some(timeZone)), {
		onNone: () => BookingsError.make({message: `The time ${time} could not be read.`}),
		onSome: Effect.succeed
	})
}

// A ticket read wrong can end before it starts; nothing is saved from it.
function inOrder(start: DateTime.Utc, end: DateTime.Utc, what: string) {
	if (DateTime.isLessThan(start, end)) return Effect.void
	return BookingsError.make({message: `${what} ends before it starts; check the ticket's dates and times.`})
}

function asStorageBookingsError(cause: SqlError.SqlError | Schema.SchemaError) {
	return BookingsError.make({cause, message: 'The trips storage failed.'})
}

const asBookingsError = Effect.mapError(asStorageBookingsError)

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

		const listFlights = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Flight,
			execute: () => sql`SELECT * FROM ${sql(Flight.table)}`
		})

		// Soonest first, live delays included, as the phone lists them.
		const listAll = Effect.map(listFlights(), Array.sort(byDeparture))

		const find = SqlSchema.findOneOption({
			Request: BookingId,
			Result: Flight,
			execute: id => sql`SELECT * FROM ${sql(Flight.table)} WHERE id = ${id}`
		})

		const watch = pipe(
			sql.reactive(['bookings'], listAll),
			// Only the newest list matters to a reader that falls behind.
			Stream.buffer({capacity: 1, strategy: 'sliding'}),
			Stream.mapError(asStorageBookingsError),
			Stream.withSpan('Bookings.watch', {attributes: {'rpc.stream': true}})
		)

		// Airports resolve from their dataset, so a time reads in the right zone and a ride has coordinates.
		const resolve = Effect.fnUntraced(function* (item: ExtractedItem) {
			const from = yield* places.airport(item.from)
			const to = yield* places.airport(item.to)
			const departs = yield* at(item.departure, from.timeZone)
			const arrives = yield* at(item.arrival, to.timeZone)
			yield* inOrder(departs, arrives, `${item.airlineCode} ${item.flightNumber}`)
			return Flight.make({
				airline: item.airlineName,
				airlineCode: item.airlineCode,
				arrives,
				boardingAt: yield* Effect.transposeOption(Option.map(item.boarding, boarding => at(boarding, from.timeZone))),
				boardingGroup: item.boardingGroup,
				confirmation: item.confirmation,
				departs,
				from,
				id: BookingId.make(yield* random.uuidV4()),
				live: Option.none(),
				number: item.flightNumber,
				seat: item.seat,
				status: item.status,
				to
			})
		})

		// Every segment merges into the bookings as they are inside the caller's write transaction, so two saves never lose each other's merge.
		const merge = Effect.fnUntraced(function* (incoming: BookingList) {
			const current = yield* listAll
			const stored = Record.fromIterableBy(current, booking => booking.id)
			yield* Effect.forEach(
				upsert(current, incoming),
				booking =>
					pipe(
						stored,
						Record.get(booking.id),
						Option.match({
							onNone: () => flights.insertVoid(booking),
							onSome: before =>
								pipe(
									before,
									Equal.equals(booking),
									Boolean.match({onFalse: () => flights.updateVoid(booking), onTrue: () => Effect.void})
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
					flights.delete(id),
					Reactivity.mutation(['bookings']),
					sql.withTransaction,
					Effect.mapError(cause => BookingsError.make({cause, message: 'The booking was not deleted.'}))
				)
			}, withReactivity),
			// The newer state replaces the one it was made from, unless the booking changed or left meanwhile.
			replace: Effect.fn('Bookings.replace')(function* (before: Flight, after: Flight) {
				yield* Effect.annotateCurrentSpan('bookingId', before.id)
				yield* pipe(
					find(before.id),
					Effect.flatMap(current =>
						pipe(
							current,
							Option.exists(row => Equal.equals(row, before)),
							Boolean.match({onFalse: () => Effect.void, onTrue: () => flights.updateVoid(after)})
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
export const layerBookings = Layer.provide(Bookings.layer, Layer.mergeAll(Places.layer, Extractor.layer))
