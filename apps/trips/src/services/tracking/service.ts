import type {Schema} from 'effect'
import {
	Array,
	Clock,
	Config,
	Context,
	DateTime,
	Effect,
	Layer,
	Number,
	Option,
	Record,
	Redacted,
	Ref,
	Schedule,
	Semaphore,
	String,
	pipe
} from 'effect'

import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {checkEvery, HOUR, isDue, MINUTE} from '#services/bookings/lib/utils.ts'
import type {Booking, Flight, Train} from '#services/bookings/schema.ts'
import {BookingsError} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'
import {flightTracking, pickFlight, trainTracking} from '#services/tracking/lib/utils.ts'
import {FaFlights, Usage, VtRun, VtStatus} from '#services/tracking/schema.ts'

// FlightAware's personal plan includes $5 a month, a thousand lookups.
const MONTHLY_LOOKUPS = 1000

function failed(message: string) {
	return Effect.mapError((cause: unknown) => BookingsError.make({cause, message}))
}

function iso(time: number) {
	return DateTime.formatIso(DateTime.makeUnsafe(time))
}

// Asks FlightAware and ViaggiaTreno about each journey on a schedule that tightens near departure and arrival.
export class Tracker extends Context.Service<
	Tracker,
	{readonly refresh: (id: Flight['id']) => Effect.Effect<void, BookingsError>}
>()('@deslop/trips/services/tracking/service/Tracker') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const bookings = yield* Bookings
			const client = yield* HttpClient.HttpClient
			const key = yield* Config.option(Config.Redacted('AEROAPI_KEY'))
			const usage = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Usage)

			const spend = Effect.gen(function* () {
				const month = String.slice(0, 7)(iso(yield* Clock.currentTimeMillis))
				const current = Option.getOrElse(
					Option.filter(
						yield* Effect.orElseSucceed(usage.get('aeroapi'), Option.none<Usage>),
						saved => saved.month === month
					),
					() => ({calls: 0, month})
				)
				if (current.calls >= MONTHLY_LOOKUPS) {
					return yield* BookingsError.make({
						message: `FlightAware's ${MONTHLY_LOOKUPS} lookups for ${month} are used up.`
					})
				}
				yield* failed('The lookup count could not be saved.')(usage.set('aeroapi', {calls: current.calls + 1, month}))
			})

			const flight = Effect.fnUntraced(function* (booking: Flight, now: number) {
				const apiKey = yield* Option.match(key, {
					onNone: () => BookingsError.make({message: 'The server has no FlightAware key.'}),
					onSome: Effect.succeed
				})
				yield* spend
				const answer = yield* pipe(
					HttpClientRequest.get(
						`https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(`${booking.airlineCode}${booking.number}`)}`,
						{
							headers: {'x-apikey': Redacted.value(apiKey)},
							urlParams: {
								// FlightAware searches at most two days ahead.
								end: iso(Number.min(booking.departs + 12 * HOUR, now + 47 * HOUR)),
								ident_type: 'designator',
								max_pages: '1',
								start: iso(booking.departs - 12 * HOUR)
							}
						}
					),
					client.execute,
					Effect.flatMap(HttpClientResponse.filterStatusOk),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(FaFlights)),
					Effect.timeout('20 seconds'),
					failed(`FlightAware did not answer for ${booking.airlineCode} ${booking.number}.`)
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
					failed(`ViaggiaTreno did not answer for train ${booking.number}.`)
				)
			}

			const train = Effect.fnUntraced(function* (booking: Train, now: number) {
				// Today's run must be the booked one: it starts at most a day before the booked departure.
				const run = Option.filter(yield* viaggiaTreno(`cercaNumeroTreno/${booking.number}`, VtRun, booking), found =>
					Option.exists(
						Number.parse(found.millisDataPartenza),
						started => started <= booking.departs && booking.departs - started < 30 * HOUR
					)
				)
				return yield* Option.match(run, {
					onNone: () => Effect.succeedNone,
					onSome: today =>
						Effect.map(
							viaggiaTreno(
								`andamentoTreno/${today.codLocOrig}/${booking.number}/${today.millisDataPartenza}`,
								VtStatus,
								booking
							),
							Option.flatMap(answer => trainTracking(answer, booking, now))
						)
				})
			})

			// A failed or unmatched lookup still counts as an attempt, so the schedule waits before asking again; only a real answer is saved.
			const attempts = yield* Ref.make(Record.empty<string, number>())

			const observe = Effect.fnUntraced(function* (booking: Booking, now: number) {
				if (booking._tag === 'stay') return
				yield* Ref.update(attempts, Record.set(booking.id, now))
				if (booking._tag === 'flight') {
					return yield* Option.match(yield* flight(booking, now), {
						onNone: () => Effect.void,
						onSome: live =>
							bookings.update(booking.id, item => {
								if (item._tag !== 'flight') return item
								return {...item, live}
							})
					})
				}
				return yield* Option.match(yield* train(booking, now), {
					onNone: () => Effect.void,
					onSome: live =>
						bookings.update(booking.id, item => {
							if (item._tag !== 'train') return item
							return {...item, live}
						})
				})
			})

			// One lookup at a time keeps within FlightAware's ten a minute and its monthly count exact; each is admitted again once its turn comes.
			const turns = yield* Semaphore.make(1)
			const check = Effect.fnUntraced(function* (
				id: Flight['id'],
				admits: (booking: Booking, now: number, attempted: number) => boolean
			) {
				const now = yield* Clock.currentTimeMillis
				const attempted = Option.getOrElse(Record.get(yield* Ref.get(attempts), id), () => 0)
				yield* Option.match(
					Array.findFirst(yield* bookings.list, item => item.id === id && admits(item, now, attempted)),
					{onNone: () => Effect.void, onSome: booking => observe(booking, now)}
				)
			}, Semaphore.withPermit(turns))

			// A pull to refresh asks at once, at most once a minute and only while the journey is tracked, so it cannot drain FlightAware's allowance.
			const refresh = Effect.fn('Tracker.refresh')(function* (id: Flight['id']) {
				yield* check(
					id,
					(booking, now, attempted) => Option.isSome(checkEvery(booking, now)) && now - attempted >= MINUTE
				)
			})

			const round = Effect.gen(function* () {
				const now = yield* Clock.currentTimeMillis
				const attempted = yield* Ref.get(attempts)
				yield* Effect.forEach(
					Array.filter(yield* bookings.list, booking =>
						isDue(
							booking,
							now,
							Option.getOrElse(Record.get(attempted, booking.id), () => 0)
						)
					),
					booking =>
						pipe(
							check(booking.id, isDue),
							Effect.withSpan('Tracker.check'),
							Effect.ignore({log: 'Warn', message: `The live status of ${booking.id} was not read`})
						),
					{concurrency: 1, discard: true}
				)
			})

			yield* Effect.forkScoped(Effect.repeat(round, Schedule.spaced('30 seconds')))

			return Tracker.of({refresh})
		})
	)
}
