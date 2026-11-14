import {
	Array,
	Config,
	Context,
	DateTime,
	Duration,
	Effect,
	Function,
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

import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import type {BookingId} from '#services/bookings/schema.ts'
import {Booking, BookingsError, Flight, Train, TripNumber} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'
import {checkEvery, flightTracking, isDue, pickFlight, trainTracking} from '#services/tracking/lib/utils.ts'
import {FaFlights, Lookups, VtRun, VtStatus} from '#services/tracking/schema.ts'

// FlightAware's personal plan includes $5 a month, a thousand lookups.
const MONTHLY_LOOKUPS = 1000

function asBookingsError(message: string) {
	return Effect.mapError((cause: unknown) => BookingsError.make({cause, message}))
}

function iso(time: DateTime.Utc) {
	return DateTime.formatIso(time)
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
				const month = String.slice(0, 7)(iso(yield* DateTime.now))
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

		const flight = Effect.fnUntraced(function* (booking: Flight, now: DateTime.Utc) {
			const number = yield* asBookingsError('This flight number is invalid. Add its ticket again.')(
				Schema.decodeEffect(TripNumber)(booking.number)
			)
			const apiKey = yield* Option.match(key, {
				onNone: () => BookingsError.make({message: 'The server has no FlightAware key.'}),
				onSome: Effect.succeed
			})
			yield* spend
			const answer = yield* pipe(
				HttpClientRequest.get(
					`https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(`${booking.airlineCode}${number}`)}`,
					{
						headers: {'x-apikey': Redacted.value(apiKey)},
						urlParams: {
							// FlightAware searches at most two days ahead.
							end: iso(
								pipe(
									booking.departs,
									DateTime.addDuration(Duration.hours(12)),
									DateTime.min(DateTime.addDuration(now, Duration.hours(47)))
								)
							),
							ident_type: 'designator',
							max_pages: '1',
							start: iso(DateTime.subtractDuration(booking.departs, Duration.hours(12)))
						}
					}
				),
				client.execute,
				Effect.flatMap(HttpClientResponse.filterStatusOk),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(FaFlights)),
				Effect.timeout('20 seconds'),
				asBookingsError(`FlightAware did not answer for ${booking.airlineCode} ${booking.number}.`)
			)
			return Option.map(pickFlight(answer.flights, booking), found => flightTracking(found, now, booking.live))
		})

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
				Effect.retry({schedule: Schedule.exponential('1 second'), times: 2}),
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
					pipe(found.millisDataPartenza, DateTime.distance(booking.departs), Duration.isLessThan(Duration.hours(30)))
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
			yield* Ref.update(attempts, Record.set(booking.id, now))
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

		// One lookup at a time keeps within FlightAware's ten a minute and its monthly count exact; each is admitted again once its turn comes.
		const turns = yield* Semaphore.make(1)
		const check = Effect.fnUntraced(function* (
			id: BookingId,
			admits: (booking: Booking, now: DateTime.Utc, attempted: Option.Option<DateTime.Utc>) => boolean
		) {
			const now = yield* DateTime.now
			const attempted = Record.get(yield* Ref.get(attempts), id)
			yield* pipe(
				yield* bookings.list,
				Array.findFirst(item => item.id === id && admits(item, now, attempted)),
				Option.match({onNone: () => Effect.void, onSome: booking => observe(booking, now)})
			)
		}, Semaphore.withPermit(turns))

		yield* pipe(
			Effect.gen(function* () {
				const now = yield* DateTime.now
				const attempted = yield* Ref.get(attempts)
				yield* pipe(
					yield* bookings.list,
					Array.filter(booking => isDue(booking, now, Record.get(attempted, booking.id))),
					Effect.forEach(
						booking =>
							pipe(
								check(booking.id, isDue),
								Effect.withSpan('Tracking.check', {attributes: {bookingId: booking.id}}),
								Effect.ignore({log: 'Warn', message: `The live status of ${booking.id} was not read`})
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
		Migrator.make({})({
			loader: Migrator.fromRecord({
				'0001_lookups': Effect.gen(function* () {
					yield* (yield* SqlClient.SqlClient)`CREATE TABLE lookups (month TEXT PRIMARY KEY, calls INTEGER NOT NULL) STRICT`
				})
			}),
			table: 'tracking_migrations'
		})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}
