import type {Cause} from 'effect'
import {
	Array,
	Context,
	DateTime,
	Duration,
	Effect,
	FiberSet,
	Function,
	HashSet,
	Layer,
	Option,
	Record,
	Ref,
	Schedule,
	Schema,
	Semaphore,
	String,
	Struct,
	pipe
} from 'effect'

import type {HttpClientError} from 'effect/http'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {FlightAware} from './lib/flightaware.ts'
import {migrations} from './migrations.ts'

import type {FlightId} from '#services/flights/schema.ts'
import {FlightsError, Flight, TripNumber} from '#services/flights/schema.ts'
import {Flights} from '#services/flights/service.ts'
import {checkEvery, flightTracking, isDue, pickFlight, sameLookup} from '#services/tracking/lib/utils.ts'
import {Lookups} from '#services/tracking/schema.ts'

// FlightAware's personal plan includes $5 a month, a thousand lookups.
const MONTHLY_LOOKUPS = 1000

function asFlightsError(message: string) {
	return Effect.mapError((cause: HttpClientError.HttpClientError | Schema.SchemaError | Cause.TimeoutError) =>
		FlightsError.make({cause, message})
	)
}

export class Tracking extends Context.Service<Tracking>()('@deslop/trips/services/tracking/service/Tracking', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const flights = yield* Flights
		const flightAware = yield* FlightAware

		const findLookups = SqlSchema.findOneOption({
			Request: Schema.String,
			Result: Lookups,
			execute: month => sql`SELECT * FROM ${sql(Lookups.table)} WHERE month = ${month}`
		})
		// The month's count replaces any other month's, which nothing reads again.
		const saveLookups = SqlSchema.void({
			Request: Lookups.insert,
			execute: row => sql`
				INSERT INTO ${sql(Lookups.table)} ${sql.insert(row)}
				ON CONFLICT (month) DO UPDATE SET calls = excluded.calls
			`
		})
		const forgetOtherMonths = SqlSchema.void({
			Request: Schema.String,
			execute: month => sql`DELETE FROM ${sql(Lookups.table)} WHERE month <> ${month}`
		})

		const spend = pipe(
			Effect.gen(function* () {
				const month = String.slice(0, 7)(DateTime.formatIso(yield* DateTime.now))
				const calls = Option.match(yield* findLookups(month), {onNone: Function.constant(0), onSome: row => row.calls})
				if (calls >= MONTHLY_LOOKUPS) {
					return yield* FlightsError.make({
						message: `FlightAware's ${MONTHLY_LOOKUPS} lookups for ${month} are used up.`
					})
				}
				yield* forgetOtherMonths(month)
				yield* saveLookups({calls: calls + 1, month})
			}),
			sql.withTransaction,
			Effect.catchTag(['SqlError', 'SchemaError'], cause =>
				Effect.fail(FlightsError.make({cause, message: 'The lookup count could not be saved.'}))
			)
		)

		// After FlightAware fails, every flight waits ten minutes rather than spend the month's lookups on an outage.
		const flightsPausedUntil = yield* Ref.make(Option.none<DateTime.Utc>())
		const flightsPaused = Effect.fnUntraced(function* (now: DateTime.Utc) {
			return Option.exists(yield* Ref.get(flightsPausedUntil), until => DateTime.isLessThan(now, until))
		})

		// A flight holds its turn through the request and a six-second gap.
		const flightTurns = yield* Semaphore.make(1)
		const lookup = Effect.fnUntraced(function* (flight: Flight, now: DateTime.Utc) {
			const number = yield* asFlightsError('This flight number is invalid. Add its ticket again.')(
				Schema.decodeEffect(TripNumber)(flight.number)
			)
			const ask = yield* Option.match(flightAware.flights, {
				onNone: () => FlightsError.make({message: 'The server has no FlightAware key.'}),
				onSome: Effect.succeed
			})
			if (yield* flightsPaused(now)) {
				return yield* FlightsError.make({message: 'FlightAware is not answering; Trips asks again in a few minutes.'})
			}
			yield* spend
			return yield* pipe(
				ask(`${flight.airlineCode}${number}`, flight.departs, now),
				Effect.ensuring(Effect.sleep('6 seconds')),
				Effect.timeout('20 seconds'),
				Effect.tapError(() =>
					Effect.flatMap(DateTime.now, failedAt =>
						Ref.set(flightsPausedUntil, Option.some(DateTime.addDuration(failedAt, Duration.minutes(10))))
					)
				),
				asFlightsError(`FlightAware did not answer for ${flight.airlineCode} ${flight.number}.`)
			)
		}, Semaphore.withPermit(flightTurns))

		// A failed or unmatched lookup still counts as an attempt, so the schedule waits before asking again; only a real answer is saved.
		const attempts = yield* Ref.make(Record.empty<FlightId, DateTime.Utc>())

		const observe = Effect.fnUntraced(function* (flight: Flight, riders: readonly Flight[], now: DateTime.Utc) {
			// A flight saved again meanwhile may name another service, so the answer replaces only the flight it was read for; each ticket of the flight keeps its own report.
			const answer = yield* lookup(flight, now)
			return yield* Effect.forEach(
				[flight, ...riders],
				item =>
					Option.match(pickFlight(answer.flights, item), {
						onNone: () => Effect.void,
						onSome: found =>
							flights.replace(
								item,
								Flight.make({
									...Struct.pick(item, Struct.keys(Flight.fields)),
									live: Option.some(flightTracking(found, now, item.live))
								})
							)
					}),
				{concurrency: 1, discard: true}
			)
		})

		// Admission, its attempt timestamp and the running mark are atomic, so a pull to refresh and a round never ask for one flight twice; flights take turns six seconds apart for FlightAware's ten requests a minute.
		const turns = yield* Semaphore.make(1)
		const running = yield* Ref.make(HashSet.empty<FlightId>())
		const check = Effect.fnUntraced(function* (
			id: FlightId,
			admits: (flight: Flight, now: DateTime.Utc, attempted: Option.Option<DateTime.Utc>) => boolean
		) {
			const admitted = yield* Semaphore.withPermit(
				turns,
				Effect.gen(function* () {
					const now = yield* DateTime.now
					const attempted = Record.get(yield* Ref.get(attempts), id)
					const busy = yield* Ref.get(running)
					const found = Option.filter(
						yield* flights.find(id),
						item => !HashSet.has(busy, id) && admits(item, now, attempted)
					)
					// The other tracked tickets of the flight ride on its lookup, so FlightAware is asked once however many travellers booked it, and their checks fall into step.
					const riders = yield* Option.match(found, {
						onNone: () => Effect.succeed(Array.empty<Flight>()),
						onSome: flight =>
							Effect.map(
								flights.list,
								Array.filter(
									other =>
										other.id !== flight.id &&
										!HashSet.has(busy, other.id) &&
										sameLookup(other, flight) &&
										Option.isSome(checkEvery(other, now))
								)
							)
					})
					const ids = HashSet.fromIterable(Array.map([...Option.toArray(found), ...riders], item => item.id))
					yield* Ref.update(
						attempts,
						Record.union(
							Record.fromIterableWith(ids, item => [item, now]),
							(_, latest) => latest
						)
					)
					yield* Ref.update(running, HashSet.union(ids))
					return Option.map(found, item => ({flight: item, ids, now, riders}))
				})
			)
			yield* Option.match(admitted, {
				onNone: () => Effect.void,
				onSome: ready =>
					Effect.ensuring(
						observe(ready.flight, ready.riders, ready.now),
						Ref.update(running, HashSet.difference(ready.ids))
					)
			})
		})

		const checks = yield* FiberSet.make()
		yield* pipe(
			Effect.gen(function* () {
				const now = yield* DateTime.now
				const all = yield* flights.list
				yield* Ref.update(
					attempts,
					Record.filter((_, id) => Array.some(all, flight => flight.id === id))
				)
				const attempted = yield* Ref.get(attempts)
				const paused = yield* flightsPaused(now)
				// Each check runs on its own, so a round never waits for the flights queued behind FlightAware's gap.
				yield* pipe(
					all,
					Array.filter(flight => isDue(flight, now, Record.get(attempted, flight.id)) && !paused),
					Effect.forEach(
						flight =>
							FiberSet.run(
								checks,
								pipe(
									check(flight.id, isDue),
									Effect.withSpan('Tracking.check', {attributes: {flightId: flight.id}}),
									Effect.ignore({log: 'Warn', message: `The live status of ${flight.id} was not read`})
								)
							),
						{concurrency: 1, discard: true}
					)
				)
			}),
			Effect.withSpan('Tracking.round'),
			Effect.ignore({log: 'Warn', message: 'The flights to track were not read'}),
			Effect.repeat(Schedule.spaced('30 seconds')),
			Effect.forkScoped
		)

		return {
			// A pull to refresh asks at once, at most once a minute and only while the flight is tracked, so it cannot drain FlightAware's allowance.
			refresh: Effect.fn('Tracking.refresh')(function* (id: FlightId) {
				yield* Effect.annotateCurrentSpan('flightId', id)
				yield* check(
					id,
					(flight, now, attempted) =>
						Option.isSome(checkEvery(flight, now)) &&
						Option.match(attempted, {
							onNone: Function.constTrue,
							onSome: at => pipe(at, DateTime.distance(now), Duration.isGreaterThanOrEqualTo(Duration.minutes(1)))
						})
				)
			})
		}
	})
}) {
	// The table this service owns, made and changed at start in one transaction.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({loader: Migrator.fromRecord(migrations), table: 'tracking_migrations'})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}

// FlightAware is the tracking's own internal; tests provide stand-ins to `Tracking.layer` instead.
export const layerTracking = Layer.provide(Tracking.layer, FlightAware.layer)
