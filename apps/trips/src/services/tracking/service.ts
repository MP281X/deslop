import {
	Array,
	Cause,
	Config,
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
	Redacted,
	Ref,
	Schedule,
	Schema,
	Semaphore,
	String,
	Struct,
	pipe
} from 'effect'

import type {HttpClientError} from 'effect/http'
import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {migrations} from './migrations.ts'

import type {BookingId} from '#services/bookings/schema.ts'
import {Booking, BookingsError, Flight, Train, TripNumber} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'
import {checkEvery, flightTracking, isDue, pickFlight, trainTracking} from '#services/tracking/lib/utils.ts'
import {FaFlights, Lookups, VtRun, VtStatus} from '#services/tracking/schema.ts'

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
		const client = yield* HttpClient.HttpClient
		const key = yield* Config.option(Config.Redacted('AEROAPI_KEY'))

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
		const flight = Effect.fnUntraced(function* (booking: Flight, now: DateTime.Utc) {
			const number = yield* asBookingsError('This flight number is invalid. Add its ticket again.')(
				Schema.decodeEffect(TripNumber)(booking.number)
			)
			const apiKey = yield* Option.match(key, {
				onNone: () => BookingsError.make({message: 'The server has no FlightAware key.'}),
				onSome: Effect.succeed
			})
			if (yield* flightsPaused(now)) {
				return yield* BookingsError.make({message: 'FlightAware is not answering; Trips asks again in a few minutes.'})
			}
			yield* spend
			const answer = yield* pipe(
				HttpClientRequest.get(
					`https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(`${booking.airlineCode}${number}`)}`,
					{
						headers: {'x-apikey': Redacted.value(apiKey)},
						urlParams: {
							// FlightAware searches at most two days ahead.
							end: DateTime.formatIso(
								pipe(
									booking.departs,
									DateTime.addDuration(Duration.hours(12)),
									DateTime.min(DateTime.addDuration(now, Duration.hours(47)))
								)
							),
							ident_type: 'designator',
							max_pages: '1',
							start: DateTime.formatIso(DateTime.subtractDuration(booking.departs, Duration.hours(12)))
						}
					}
				),
				client.execute,
				Effect.ensuring(Effect.sleep('6 seconds')),
				Effect.flatMap(HttpClientResponse.filterStatusOk),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(FaFlights)),
				Effect.timeout('20 seconds'),
				Effect.tapError(() =>
					Effect.flatMap(DateTime.now, failedAt =>
						Ref.set(flightsPausedUntil, Option.some(DateTime.addDuration(failedAt, Duration.minutes(10))))
					)
				),
				asBookingsError(`FlightAware did not answer for ${booking.airlineCode} ${booking.number}.`)
			)
			return Option.map(pickFlight(answer.flights, booking), found => flightTracking(found, now, booking.live))
		}, Semaphore.withPermit(flightTurns))

		function viaggiaTreno<S extends Schema.Top>(path: string, schema: S, booking: Train) {
			return pipe(
				// ViaggiaTreno answers only over plain HTTP, and its CDN refuses a client without a browser's User-Agent.
				client.get(`http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/${path}`, {
					headers: {
						'user-agent':
							'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
					}
				}),
				Effect.flatMap(HttpClientResponse.filterStatusOk),
				Effect.flatMap(response => {
					// No content means the number does not run today.
					if (response.status === 204) return Effect.succeedNone
					return Effect.asSome(HttpClientResponse.schemaBodyJson(schema)(response))
				}),
				Effect.timeout('15 seconds'),
				Effect.retry({
					schedule: Schedule.exponential('1 second'),
					times: 2,
					while: error => Cause.isTimeoutError(error) || HttpClient.isTransientError(error)
				}),
				asBookingsError(`ViaggiaTreno did not answer for train ${booking.number}.`)
			)
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

		const observe = Effect.fnUntraced(function* (booking: Booking, now: DateTime.Utc) {
			if (Booking.isAnyOf(['stay'])(booking)) return
			// A booking saved again meanwhile may name another service, so the answer replaces only the booking it was read for.
			if (Booking.isAnyOf(['flight'])(booking)) {
				return yield* Option.match(yield* flight(booking, now), {
					onNone: () => Effect.void,
					onSome: live =>
						bookings.replace(
							booking,
							Flight.make({...Struct.pick(booking, Struct.keys(Flight.fields)), live: Option.some(live)})
						)
				})
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
					const busy = HashSet.has(yield* Ref.get(running), id)
					const booking = Option.filter(yield* bookings.find(id), item => !busy && admits(item, now, attempted))
					if (Option.isSome(booking)) {
						yield* Ref.update(attempts, Record.set(id, now))
						yield* Ref.update(running, HashSet.add(id))
					}
					return Option.map(booking, item => ({booking: item, now}))
				})
			)
			yield* Option.match(admitted, {
				onNone: () => Effect.void,
				onSome: ready => Effect.ensuring(observe(ready.booking, ready.now), Ref.update(running, HashSet.remove(id)))
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
