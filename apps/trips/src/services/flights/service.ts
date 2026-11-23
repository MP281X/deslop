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

import {byDeparture, instantOf, upsert} from '#services/flights/lib/utils.ts'
import type {FlightList, TicketSource, ExtractedFlight, LocalTime} from '#services/flights/schema.ts'
import {FlightId, FlightsError, Flight} from '#services/flights/schema.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly flights: never
	}
}

function at(time: LocalTime, timeZone: string) {
	return Option.match(instantOf(time, Option.some(timeZone)), {
		onNone: () => FlightsError.make({message: `The time ${time} could not be read.`}),
		onSome: Effect.succeed
	})
}

// Everyone the ticket names holds its reservation; a ticket that names nobody holds it under no name, so its cancellation still finds it.
function travellersOf(item: ExtractedFlight) {
	const reservation = {confirmation: item.confirmation, status: item.status}
	return Array.match(item.travellers, {
		onEmpty: () => [{...reservation, boardingGroup: Option.none(), name: Option.none(), seat: Option.none()}],
		onNonEmpty: travellers =>
			Array.map(travellers, traveller => ({...traveller, ...reservation, name: Option.some(traveller.name)}))
	})
}

// A ticket read wrong can end before it starts; nothing is saved from it.
function inOrder(start: DateTime.Utc, end: DateTime.Utc, what: string) {
	if (DateTime.isLessThan(start, end)) return Effect.void
	return FlightsError.make({message: `${what} ends before it starts; check the ticket's dates and times.`})
}

function asStorageFlightsError(cause: SqlError.SqlError | Schema.SchemaError) {
	return FlightsError.make({cause, message: 'The trips storage failed.'})
}

const asFlightsError = Effect.mapError(asStorageFlightsError)

export class Flights extends Context.Service<Flights>()('@deslop/trips/services/flights/service/Flights', {
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
			Request: FlightId,
			Result: Flight,
			execute: id => sql`SELECT * FROM ${sql(Flight.table)} WHERE id = ${id}`
		})

		const watch = pipe(
			sql.reactive(['flights'], listAll),
			// Only the newest list matters to a reader that falls behind.
			Stream.buffer({capacity: 1, strategy: 'sliding'}),
			Stream.mapError(asStorageFlightsError),
			Stream.withSpan('Flights.watch', {attributes: {'rpc.stream': true}})
		)

		// Airports resolve from their dataset, so a time reads in the right zone and a ride has coordinates.
		const resolve = Effect.fnUntraced(function* (item: ExtractedFlight) {
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
				departs,
				from,
				id: FlightId.make(yield* random.uuidV4()),
				live: Option.none(),
				number: item.flightNumber,
				to,
				travellers: travellersOf(item)
			})
		})

		// Every segment merges into the flights as they are inside the caller's write transaction, so two saves never lose each other's merge; a flight a rebooking left with nobody on it goes.
		const merge = Effect.fnUntraced(function* (incoming: FlightList) {
			const current = yield* listAll
			const stored = Record.fromIterableBy(current, flight => flight.id)
			const next = upsert(current, incoming)
			const kept = Record.fromIterableBy(next, flight => flight.id)
			yield* pipe(
				current,
				Array.filter(flight => !Record.has(kept, flight.id)),
				Effect.forEach(flight => flights.delete(flight.id), {concurrency: 1, discard: true})
			)
			yield* Effect.forEach(
				next,
				flight =>
					pipe(
						stored,
						Record.get(flight.id),
						Option.match({
							onNone: () => flights.insertVoid(flight),
							onSome: before =>
								pipe(
									before,
									Equal.equals(flight),
									Boolean.match({onFalse: () => flights.updateVoid(flight), onTrue: () => Effect.void})
								)
						})
					),
				{concurrency: 1, discard: true}
			)
		})

		return {
			// What the phone watches: the whole list first, then only what changed, after each commit.
			events: Stream.withSpan(
				listEvents(watch, flight => flight.id),
				'Flights.events',
				{attributes: {'rpc.stream': true}}
			),
			find: Effect.fn('Flights.find')((id: FlightId) => asFlightsError(find(id))),
			list: pipe(listAll, asFlightsError, Effect.withSpan('Flights.list')),
			passText,
			remove: Effect.fn('Flights.remove')(function* (id: FlightId) {
				yield* Effect.annotateCurrentSpan('flightId', id)
				yield* pipe(
					flights.delete(id),
					Reactivity.mutation(['flights']),
					sql.withTransaction,
					Effect.mapError(cause => FlightsError.make({cause, message: 'The flight was not deleted.'}))
				)
			}, withReactivity),
			// The newer state replaces the one it was made from, unless the flight changed or left meanwhile.
			replace: Effect.fn('Flights.replace')(function* (before: Flight, after: Flight) {
				yield* Effect.annotateCurrentSpan('flightId', before.id)
				yield* pipe(
					find(before.id),
					Effect.flatMap(current =>
						pipe(
							current,
							Option.exists(row => Equal.equals(row, before)),
							Boolean.match({onFalse: () => Effect.void, onTrue: () => flights.updateVoid(after)})
						)
					),
					Reactivity.mutation(['flights']),
					sql.withTransaction,
					asFlightsError
				)
			}, withReactivity),
			save: Effect.fn('Flights.save')(function* (userId: UserId, source: TicketSource) {
				yield* Effect.annotateCurrentSpan('userId', userId)
				const items = yield* extractor.read(userId, source)
				if (Array.isReadonlyArrayEmpty(items)) {
					return yield* FlightsError.make({
						message: 'No flight found. Copy a confirmation or boarding pass and try again.'
					})
				}
				// Every segment or none, so a ticket is never half saved; the failure names the place to fix.
				const resolved = yield* Effect.forEach(items, item => Effect.result(resolve(item)), {concurrency: 1})
				const issues = Array.getFailures(resolved)
				if (Array.isReadonlyArrayNonEmpty(issues)) {
					return yield* FlightsError.make({
						cause: issues,
						message: 'Some ticket segments could not be resolved. Check their places and times; no segments were saved.'
					})
				}
				yield* pipe(
					merge(Array.getSuccesses(resolved)),
					Reactivity.mutation(['flights']),
					sql.withTransaction,
					asFlightsError
				)
			}, withReactivity),
			// What the push rounds follow: the whole list again after each commit.
			watch
		}
	})
}) {
	// The tables this service owns, made and changed at start in one transaction, under the migration table's name from when Trips kept other bookings; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({loader: Migrator.fromRecord(migrations), table: 'bookings_migrations'})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}

// Place lookups and extraction are the flights' own internals; tests provide stand-ins to `Flights.layer` instead.
export const layerFlights = Layer.provide(Flights.layer, Layer.mergeAll(Places.layer, Extractor.layer))
