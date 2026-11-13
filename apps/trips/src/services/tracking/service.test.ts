import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	Cause,
	Clock,
	ConfigProvider,
	Context,
	Deferred,
	Effect,
	Equal,
	Exit,
	Fiber,
	Layer,
	Option,
	Queue,
	Ref,
	Stream,
	String,
	pipe
} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {SqlClient} from 'effect/sql'
import {TestClock} from 'effect/testing'

import {HOUR} from '#services/bookings/lib/utils.ts'
import type {Booking} from '#services/bookings/schema.ts'
import {Flight, Train} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'
import {Tracking} from '#services/tracking/service.ts'

const ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

const FLIGHT = {
	airline: 'British Airways',
	airlineCode: 'BA',
	arrives: 3 * HOUR,
	boardingAt: Option.none(),
	boardingGroup: Option.none(),
	confirmation: Option.none(),
	departs: 2 * HOUR,
	from: {code: 'FCO', name: 'Rome', timeZone: 'Europe/Rome'},
	id: ID,
	live: Option.none(),
	number: '553',
	seat: Option.none(),
	status: 'confirmed',
	to: {code: 'LHR', name: 'London', timeZone: 'Europe/London'}
} as const

const TRAIN = {
	arrives: 3 * HOUR,
	coach: Option.none(),
	confirmation: Option.none(),
	departs: 2 * HOUR,
	from: {name: 'Roma Termini', timeZone: 'Europe/Rome'},
	id: ID,
	live: Option.none(),
	number: '9541',
	operator: 'trenitalia',
	operatorName: 'Frecciarossa',
	seat: Option.none(),
	status: 'confirmed',
	to: {name: 'Milano Centrale', timeZone: 'Europe/Rome'}
} as const

// The bookings as a list in memory; a newer state replaces the one it was made from only while that one is still stored.
function bookingsAt(state: Ref.Ref<Booking[]>, listed?: Queue.Queue<void>) {
	return Bookings.of({
		events: Stream.never,
		list: Effect.tap(Ref.get(state), () =>
			Option.match(Option.fromUndefinedOr(listed), {
				onNone: () => Effect.void,
				onSome: queue => Queue.offer(queue, undefined)
			})
		),
		remove: () => Effect.void,
		replace: Effect.fnUntraced(function* (before, after) {
			return yield* pipe(
				state,
				Ref.update(
					Array.map(booking =>
						pipe(booking, Equal.equals(before), Boolean.match({onFalse: () => booking, onTrue: () => after}))
					)
				),
				Effect.andThen(Effect.undefined)
			)
		}),
		save: () => Effect.undefined,
		watch: Stream.never
	})
}

// A tracker over its own empty database, and the lookup counts that database holds.
const open = Effect.fnUntraced(function* (bookings: typeof Bookings.Service, client: HttpClient.HttpClient) {
	const database = yield* Layer.build(SqliteClient.layer({filename: ':memory:'}))
	const tracker = Context.get(
		yield* Layer.build(
			pipe(
				Tracking.layer,
				Layer.provide(Layer.succeedContext(database)),
				Layer.provide(Layer.succeed(Bookings, bookings)),
				Layer.provide(Layer.succeed(HttpClient.HttpClient, client))
			)
		),
		Tracking
	)
	const sql = Context.get(database, SqlClient.SqlClient)
	return {lookups: sql<{calls: number; month: string}>`SELECT month, calls FROM lookups`, sql, tracker}
})

it.layer(ConfigProvider.layer(ConfigProvider.fromUnknown({AEROAPI_KEY: 'test'})))(test => {
	test.effect(
		'refuses legacy dot-segment and non-numeric numbers before any provider lookup or spend',
		Effect.fnUntraced(function* () {
			yield* TestClock.adjust('1 hour')
			const state = yield* Ref.make<Booking[]>([])
			const calls = yield* Ref.make(0)
			const listed = yield* Queue.unbounded<void>()
			const opened = yield* open(
				bookingsAt(state, listed),
				HttpClient.make(request =>
					Effect.as(
						Ref.update(calls, count => count + 1),
						HttpClientResponse.fromWeb(request, new Response(undefined, {status: 204}))
					)
				)
			)
			yield* Queue.take(listed)
			for (const booking of [Train.make(TRAIN), Flight.make(FLIGHT)]) {
				for (const number of ['.', '..', '../../path', '9541?other=true']) {
					yield* Ref.set(state, [
						Boolean.match(booking._tag === 'flight', {
							onFalse: () => Train.make({...TRAIN, number}),
							onTrue: () => Flight.make({...FLIGHT, number})
						})
					])
					const result = yield* Effect.exit(opened.tracker.refresh(booking.id))
					assert.isTrue(
						Exit.hasFails(result),
						Exit.match(result, {onFailure: Cause.pretty, onSuccess: () => `${booking._tag}: ${number} skipped`})
					)
					assert.strictEqual(yield* Ref.get(calls), 0)
					yield* Ref.set(state, [])
					yield* TestClock.adjust('1 minute')
				}
			}
			assert.deepStrictEqual(yield* opened.lookups, [])
		})
	)

	test.effect(
		'discards flight and train answers after rebooking, but saves an unchanged reservation',
		Effect.fnUntraced(function* () {
			yield* TestClock.adjust('1 hour')
			for (const booking of [Flight.make(FLIGHT), Train.make(TRAIN)]) {
				const state = yield* Ref.make<Booking[]>([])
				const asked = yield* Deferred.make<boolean>()
				const release = yield* Deferred.make<boolean>()
				const client = HttpClient.make(request =>
					Effect.gen(function* () {
						if (String.includes('cercaNumeroTreno')(request.url)) {
							return HttpClientResponse.fromWeb(request, Response.json({codLocOrig: 'S08409', millisDataPartenza: '0'}))
						}
						yield* Deferred.succeed(asked, true)
						yield* Deferred.await(release)
						return HttpClientResponse.fromWeb(
							request,
							Response.json(
								Boolean.match(booking._tag === 'flight', {
									onFalse: () => ({
										fermate: [
											{
												binarioEffettivoPartenzaDescrizione: '12',
												id: 'S08409',
												programmata: 2 * HOUR,
												stazione: 'ROMA TERMINI'
											}
										]
									}),
									onTrue: () => ({
										flights: [
											{
												cancelled: false,
												diverted: false,
												fa_flight_id: 'old-flight',
												gate_origin: 'B12',
												origin: {code_iata: 'FCO'},
												scheduled_out: '1970-01-01T02:00:00Z'
											}
										]
									})
								})
							)
						)
					})
				)
				const opened = yield* open(bookingsAt(state), client)
				yield* Ref.set(state, [booking])
				const lookup = yield* Effect.forkScoped(opened.tracker.refresh(booking.id))
				yield* Deferred.await(asked)
				const replacement = Boolean.match(booking._tag === 'flight', {
					onFalse: () => Train.make({...TRAIN, number: '999'}),
					onTrue: () => Flight.make({...FLIGHT, number: '999'})
				})
				yield* Ref.set(state, [replacement])
				yield* Deferred.succeed(release, true)
				yield* Fiber.join(lookup)
				assert.deepStrictEqual(yield* Ref.get(state), [replacement])
				yield* Ref.set(state, [booking])
				yield* TestClock.adjust('1 minute')
				yield* opened.tracker.refresh(booking.id)
				assert.isTrue(
					Option.exists(
						Array.head(yield* Ref.get(state)),
						current => current._tag !== 'stay' && Option.isSome(current.live)
					)
				)
			}
		})
	)

	test.effect(
		"counts FlightAware's lookups by month and stops at the month's thousandth",
		Effect.fnUntraced(function* () {
			yield* TestClock.adjust('1 hour')
			const state = yield* Ref.make<Booking[]>([Flight.make(FLIGHT)])
			const calls = yield* Ref.make(0)
			const opened = yield* open(
				bookingsAt(state),
				HttpClient.make(request =>
					Effect.as(
						Ref.update(calls, count => count + 1),
						HttpClientResponse.fromWeb(request, Response.json({flights: []}))
					)
				)
			)
			yield* opened.tracker.refresh(ID)
			assert.deepStrictEqual(yield* opened.lookups, [{calls: 1, month: '1970-01'}])
			yield* opened.sql`UPDATE lookups SET calls = 1000`
			yield* TestClock.adjust('1 minute')
			assert.isTrue(Exit.hasFails(yield* Effect.exit(opened.tracker.refresh(ID))))
			assert.strictEqual(yield* Ref.get(calls), 1)
			// A new month starts its own count, and the old month's row goes.
			yield* TestClock.adjust('31 days')
			yield* Ref.set(state, [
				Flight.make({
					...FLIGHT,
					arrives: (yield* Clock.currentTimeMillis) + 3 * HOUR,
					departs: (yield* Clock.currentTimeMillis) + 2 * HOUR
				})
			])
			yield* opened.tracker.refresh(ID)
			assert.deepStrictEqual(yield* opened.lookups, [{calls: 1, month: '1970-02'}])
		})
	)

	test.effect(
		'retries a malformed train run lookup three times, then fails without storing an answer',
		Effect.fnUntraced(function* () {
			const now = yield* Clock.currentTimeMillis
			const train = Train.make({...TRAIN, arrives: now + 2 * HOUR, departs: now + HOUR})
			const state = yield* Ref.make<Booking[]>([])
			const listed = yield* Queue.unbounded<void>()
			const calls = yield* Ref.make(0)
			const opened = yield* open(
				bookingsAt(state, listed),
				HttpClient.make(request =>
					Effect.gen(function* () {
						yield* Ref.update(calls, count => count + 1)
						return HttpClientResponse.fromWeb(
							request,
							Response.json({codLocOrig: '../S08409', millisDataPartenza: 'not-a-number'})
						)
					})
				)
			)
			yield* Queue.take(listed)
			yield* Ref.set(state, [train])
			const lookup = yield* Effect.forkScoped(Effect.exit(opened.tracker.refresh(train.id)))
			yield* TestClock.adjust('5 seconds')
			const result = yield* Fiber.join(lookup)
			assert.strictEqual(yield* Ref.get(calls), 3)
			assert.isTrue(Exit.hasFails(result), Exit.match(result, {onFailure: Cause.pretty, onSuccess: () => 'no failure'}))
			assert.deepStrictEqual(yield* opened.lookups, [])
			assert.deepStrictEqual(yield* Ref.get(state), [train])
		})
	)
})
