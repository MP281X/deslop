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
import {ViaggiaTreno} from './lib/viaggiatreno.ts'
import {migrations} from './migrations.ts'

import type {BookingId} from '#services/bookings/schema.ts'
import {Booking, BookingsError, Flight, Train, TripNumber} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'
import {checkEvery, flightTracking, isDue, pickFlight, sameLookup, trainTracking} from '#services/tracking/lib/utils.ts'
import {Lookups, VtRun, VtStatus} from '#services/tracking/schema.ts'

// FlightAware's personal plan includes $5 a month, a thousand lookups.
const MONTHLY_LOOKUPS = 1000

function asBookingsError(message: string) {
	return Effect.mapError((cause: HttpClientError.HttpClientError | Schema.SchemaError | Cause.TimeoutError) =>
		BookingsError.make({cause, message})
	)
}

export class Tracking extends Context.Service<Tracking>()('@deslop/trips/services/tracking/service/Tracking', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const bookings = yield* Bookings
		const flightAware = yield* FlightAware
		const trains = yield* ViaggiaTreno

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
					return yield* BookingsError.make({
						message: `FlightAware's ${MONTHLY_LOOKUPS} lookups for ${month} are used up.`
					})
				}
				yield* forgetOtherMonths(month)
				yield* saveLookups({calls: calls + 1, month})
			}),
			sql.withTransaction,
			Effect.catchTag(['SqlError', 'SchemaError'], cause =>
				Effect.fail(BookingsError.make({cause, message: 'The lookup count could not be saved.'}))
			)
		)

		// After FlightAware fails, every flight waits ten minutes rather than spend the month's lookups on an outage.
		const flightsPausedUntil = yield* Ref.make(Option.none<DateTime.Utc>())
		const flightsPaused = Effect.fnUntraced(function* (now: DateTime.Utc) {
			return Option.exists(yield* Ref.get(flightsPausedUntil), until => DateTime.isLessThan(now, until))
		})

		// A flight holds its turn through the request and a six-second gap; trains never acquire it.
		const flightTurns = yield* Semaphore.make(1)
		const lookup = Effect.fnUntraced(function* (booking: Flight, now: DateTime.Utc) {
			const number = yield* asBookingsError('This flight number is invalid. Add its ticket again.')(
				Schema.decodeEffect(TripNumber)(booking.number)
			)
			const flights = yield* Option.match(flightAware.flights, {
				onNone: () => BookingsError.make({message: 'The server has no FlightAware key.'}),
				onSome: Effect.succeed
			})
			if (yield* flightsPaused(now)) {
				return yield* BookingsError.make({message: 'FlightAware is not answering; Trips asks again in a few minutes.'})
			}
			yield* spend
			return yield* pipe(
				flights(`${booking.airlineCode}${number}`, booking.departs, now),
				Effect.ensuring(Effect.sleep('6 seconds')),
				Effect.timeout('20 seconds'),
				Effect.tapError(() =>
					Effect.flatMap(DateTime.now, failedAt =>
						Ref.set(flightsPausedUntil, Option.some(DateTime.addDuration(failedAt, Duration.minutes(10))))
					)
				),
				asBookingsError(`FlightAware did not answer for ${booking.airlineCode} ${booking.number}.`)
			)
		}, Semaphore.withPermit(flightTurns))

		function viaggiaTreno<S extends Schema.Top>(path: string, schema: S, booking: Train) {
			return asBookingsError(`ViaggiaTreno did not answer for train ${booking.number}.`)(trains.get(path, schema))
		}

		const train = Effect.fnUntraced(function* (booking: Train, now: DateTime.Utc) {
			const number = yield* asBookingsError('This train number is invalid. Add its ticket again.')(
				Schema.decodeEffect(TripNumber)(booking.number)
			)
			// Today's run must be the booked one: it starts at most a day before the booked departure.
			const run = Option.filter(
				yield* viaggiaTreno(`cercaNumeroTreno/${number}`, VtRun, booking),
				found =>
					DateTime.isLessThanOrEqualTo(found.millisDataPartenza, booking.departs) &&
					pipe(
						found.millisDataPartenza,
						DateTime.distance(booking.departs),
						Duration.isLessThanOrEqualTo(Duration.days(1))
					)
			)
			return yield* Option.match(run, {
				onNone: () => Effect.succeedNone,
				onSome: today =>
					Effect.map(
						viaggiaTreno(
							`andamentoTreno/${today.codLocOrig}/${number}/${DateTime.toEpochMillis(today.millisDataPartenza)}`,
							VtStatus,
							booking
						),
						Option.flatMap(answer => trainTracking(answer, booking, now))
					)
			})
		})

		// A failed or unmatched lookup still counts as an attempt, so the schedule waits before asking again; only a real answer is saved.
		const attempts = yield* Ref.make(Record.empty<BookingId, DateTime.Utc>())

		const observe = Effect.fnUntraced(function* (booking: Booking, riders: readonly Flight[], now: DateTime.Utc) {
			if (Booking.isAnyOf(['stay'])(booking)) return
			// A booking saved again meanwhile may name another service, so the answer replaces only the booking it was read for; each ticket of the flight keeps its own report.
			if (Booking.isAnyOf(['flight'])(booking)) {
				const answer = yield* lookup(booking, now)
				return yield* Effect.forEach(
					[booking, ...riders],
					item =>
						Option.match(pickFlight(answer.flights, item), {
							onNone: () => Effect.void,
							onSome: found =>
								bookings.replace(
									item,
									Flight.make({
										...Struct.pick(item, Struct.keys(Flight.fields)),
										live: Option.some(flightTracking(found, now, item.live))
									})
								)
						}),
					{concurrency: 1, discard: true}
				)
			}
			return yield* Option.match(yield* train(booking, now), {
				onNone: () => Effect.void,
				onSome: live =>
					bookings.replace(
						booking,
						Train.make({...Struct.pick(booking, Struct.keys(Train.fields)), live: Option.some(live)})
					)
			})
		})

		// Admission, its attempt timestamp and the running mark are atomic, so a pull to refresh and a round never ask for one booking twice; flights take turns six seconds apart for FlightAware's ten requests a minute, while trains go on independently.
		const turns = yield* Semaphore.make(1)
		const running = yield* Ref.make(HashSet.empty<BookingId>())
		const check = Effect.fnUntraced(function* (
			id: BookingId,
			admits: (booking: Booking, now: DateTime.Utc, attempted: Option.Option<DateTime.Utc>) => boolean
		) {
			const admitted = yield* Semaphore.withPermit(
				turns,
				Effect.gen(function* () {
					const now = yield* DateTime.now
					const attempted = Record.get(yield* Ref.get(attempts), id)
					const busy = yield* Ref.get(running)
					const booking = Option.filter(
						yield* bookings.find(id),
						item => !HashSet.has(busy, id) && admits(item, now, attempted)
					)
					// The other tracked tickets of the flight ride on its lookup, so FlightAware is asked once however many travellers booked it, and their checks fall into step.
					const riders = yield* pipe(
						booking,
						Option.filter(Booking.isAnyOf(['flight'])),
						Option.match({
							onNone: () => Effect.succeed(Array.empty<Flight>()),
							onSome: flight =>
								Effect.map(
									bookings.list,
									Array.filter(
										(other): other is Flight =>
											Booking.isAnyOf(['flight'])(other) &&
											other.id !== flight.id &&
											!HashSet.has(busy, other.id) &&
											sameLookup(other, flight) &&
											Option.isSome(checkEvery(other, now))
									)
								)
						})
					)
					const ids = HashSet.fromIterable(Array.map([...Option.toArray(booking), ...riders], item => item.id))
					yield* Ref.update(
						attempts,
						Record.union(
							Record.fromIterableWith(ids, item => [item, now]),
							(_, latest) => latest
						)
					)
					yield* Ref.update(running, HashSet.union(ids))
					return Option.map(booking, item => ({booking: item, ids, now, riders}))
				})
			)
			yield* Option.match(admitted, {
				onNone: () => Effect.void,
				onSome: ready =>
					Effect.ensuring(
						observe(ready.booking, ready.riders, ready.now),
						Ref.update(running, HashSet.difference(ready.ids))
					)
			})
		})

		const checks = yield* FiberSet.make()
		yield* pipe(
			Effect.gen(function* () {
				const now = yield* DateTime.now
				const all = yield* bookings.list
				yield* Ref.update(
					attempts,
					Record.filter((_, id) => Array.some(all, booking => booking.id === id))
				)
				const attempted = yield* Ref.get(attempts)
				const paused = yield* flightsPaused(now)
				// Each check runs on its own, so a round never waits for the flights queued behind FlightAware's gap and trains keep their pace.
				yield* pipe(
					all,
					Array.filter(
						booking =>
							isDue(booking, now, Record.get(attempted, booking.id)) &&
							!(paused && Booking.isAnyOf(['flight'])(booking))
					),
					Effect.forEach(
						booking =>
							FiberSet.run(
								checks,
								pipe(
									check(booking.id, isDue),
									Effect.withSpan('Tracking.check', {attributes: {bookingId: booking.id}}),
									Effect.ignore({log: 'Warn', message: `The live status of ${booking.id} was not read`})
								)
							),
						{concurrency: 1, discard: true}
					)
				)
			}),
			Effect.withSpan('Tracking.round'),
			Effect.ignore({log: 'Warn', message: 'The bookings to track were not read'}),
			Effect.repeat(Schedule.spaced('30 seconds')),
			Effect.forkScoped
		)

		return {
			// A pull to refresh asks at once, at most once a minute and only while the journey is tracked, so it cannot drain FlightAware's allowance.
			refresh: Effect.fn('Tracking.refresh')(function* (id: BookingId) {
				yield* Effect.annotateCurrentSpan('bookingId', id)
				yield* check(
					id,
					(booking, now, attempted) =>
						Option.isSome(checkEvery(booking, now)) &&
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

// FlightAware and ViaggiaTreno are the tracking's own internals; tests provide stand-ins to `Tracking.layer` instead.
export const layerTracking = Layer.provide(Tracking.layer, Layer.merge(FlightAware.layer, ViaggiaTreno.layer))
