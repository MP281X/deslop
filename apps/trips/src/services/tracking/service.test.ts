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
import {KeyValueStore} from 'effect/persistence'
import {TestClock} from 'effect/testing'

import {HOUR} from '#services/bookings/lib/utils.ts'
import type {BookingList} from '#services/bookings/schema.ts'
import {Flight, Train} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'
import {Tracker} from '#services/tracking/service.ts'

const FLIGHT = Flight.make({
	airline: 'British Airways',
	airlineCode: 'BA',
	arrives: 3 * HOUR,
	createdAt: 0,
	departs: 2 * HOUR,
	from: {code: 'FCO', name: 'Rome', timeZone: 'Europe/Rome'},
	id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
	number: '553',
	sources: [],
	status: 'confirmed',
	to: {code: 'LHR', name: 'London', timeZone: 'Europe/London'}
})
const TRAIN = Train.make({
	arrives: 3 * HOUR,
	createdAt: 0,
	departs: 2 * HOUR,
	from: {name: 'Roma Termini', timeZone: 'Europe/Rome'},
	id: FLIGHT.id,
	number: '9541',
	operator: 'trenitalia',
	operatorName: 'Frecciarossa',
	sources: [],
	status: 'confirmed',
	to: {name: 'Milano Centrale', timeZone: 'Europe/Rome'}
})

function bookingsAt(state: Ref.Ref<BookingList>) {
	return Bookings.of({
		changes: Stream.never,
		events: Stream.never,
		list: Ref.get(state),
		remove: () => Effect.void,
		save: () => Ref.get(state),
		update: (id, change) =>
			Ref.update(
				state,
				Array.map(booking => {
					if (booking.id === id) return change(booking)
					return booking
				})
			)
	})
}

it.layer(
	Layer.merge(KeyValueStore.layerMemory, ConfigProvider.layer(ConfigProvider.fromUnknown({AEROAPI_KEY: 'test'})))
)(test => {
	test.effect(
		'refuses legacy dot-segment and non-numeric numbers before any provider lookup or spend',
		Effect.fnUntraced(function* () {
			yield* TestClock.adjust('1 hour')
			const store = yield* KeyValueStore.KeyValueStore
			yield* store.clear
			const state = yield* Ref.make<BookingList>([])
			const calls = yield* Ref.make(0)
			const initial = yield* Queue.unbounded<void>()
			const tracker = Context.get(
				yield* Layer.build(
					pipe(
						Tracker.layer,
						Layer.provide(
							Layer.succeed(Bookings, {
								...bookingsAt(state),
								list: Effect.tap(Ref.get(state), () => Queue.offer(initial, undefined))
							})
						),
						Layer.provide(
							Layer.succeed(
								HttpClient.HttpClient,
								HttpClient.make(request =>
									Effect.as(
										Ref.update(calls, count => count + 1),
										HttpClientResponse.fromWeb(request, new Response(undefined, {status: 204}))
									)
								)
							)
						)
					)
				),
				Tracker
			)
			yield* Queue.take(initial)
			for (const booking of [TRAIN, FLIGHT]) {
				for (const number of ['.', '..', '../../path', '9541?other=true']) {
					yield* Ref.set(state, [{...booking, number}])
					const result = yield* Effect.exit(tracker.refresh(booking.id))
					assert.isTrue(
						Exit.hasFails(result),
						Exit.match(result, {onFailure: Cause.pretty, onSuccess: () => `${booking._tag}: ${number} skipped`})
					)
					assert.strictEqual(yield* Ref.get(calls), 0)
					yield* Ref.set(state, [])
					yield* TestClock.adjust('1 minute')
				}
			}
			assert.isUndefined(yield* store.get('aeroapi'))
		})
	)

	test.effect(
		'discards flight and train answers after rebooking, but saves an unchanged reservation',
		Effect.fnUntraced(function* () {
			yield* TestClock.adjust('1 hour')
			for (const booking of [FLIGHT, TRAIN]) {
				const state = yield* Ref.make<BookingList>([])
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
				const tracker = Context.get(
					yield* Layer.build(
						pipe(
							Tracker.layer,
							Layer.provide(Layer.succeed(Bookings, bookingsAt(state))),
							Layer.provide(Layer.succeed(HttpClient.HttpClient, client))
						)
					),
					Tracker
				)
				yield* Ref.set(state, [booking])
				const lookup = yield* Effect.forkScoped(tracker.refresh(booking.id))
				yield* Deferred.await(asked)
				const replacement = {...booking, number: '999'}
				yield* Ref.set(state, [replacement])
				yield* Deferred.succeed(release, true)
				yield* Fiber.join(lookup)
				assert.deepStrictEqual(yield* Ref.get(state), [replacement])
				yield* Ref.set(state, [booking])
				yield* TestClock.adjust('1 minute')
				yield* tracker.refresh(booking.id)
				assert.isTrue(
					Option.exists(
						Array.head(yield* Ref.get(state)),
						current => current._tag !== 'stay' && current.live !== undefined
					)
				)
			}
		})
	)

	test.effect(
		'keeps a corrupt lookup counter intact and makes no paid request',
		Effect.fnUntraced(function* () {
			yield* TestClock.adjust('1 hour')
			const store = yield* KeyValueStore.KeyValueStore
			yield* store.set('aeroapi', 'corrupt')
			const state = yield* Ref.make<BookingList>([])
			const calls = yield* Ref.make(0)
			const client = HttpClient.make(request =>
				Effect.gen(function* () {
					yield* Ref.update(calls, count => count + 1)
					return HttpClientResponse.fromWeb(request, Response.json({flights: []}))
				})
			)
			const tracker = Context.get(
				yield* Layer.build(
					pipe(
						Tracker.layer,
						Layer.provide(Layer.succeed(Bookings, bookingsAt(state))),
						Layer.provide(Layer.succeed(HttpClient.HttpClient, client))
					)
				),
				Tracker
			)
			yield* Ref.set(state, [FLIGHT])
			assert.isTrue(Exit.hasFails(yield* Effect.exit(tracker.refresh(FLIGHT.id))))
			assert.strictEqual(yield* store.get('aeroapi'), 'corrupt')
			assert.strictEqual(yield* Ref.get(calls), 0)
		})
	)

	test.effect(
		'treats a malformed run lookup as no answer and makes no paid request',
		Effect.fnUntraced(function* () {
			const now = yield* Clock.currentTimeMillis
			const train = Train.make({...TRAIN, arrives: now + 2 * HOUR, departs: now + HOUR})
			const store = yield* KeyValueStore.KeyValueStore
			yield* store.clear
			const state = yield* Ref.make<BookingList>([])
			const initial = yield* Queue.unbounded<void>()
			const calls = yield* Ref.make(0)
			const client = HttpClient.make(request =>
				Effect.gen(function* () {
					yield* Ref.update(calls, count => count + 1)
					return HttpClientResponse.fromWeb(
						request,
						Response.json({codLocOrig: '../S08409', millisDataPartenza: 'not-a-number'})
					)
				})
			)
			const tracker = Context.get(
				yield* Layer.build(
					pipe(
						Tracker.layer,
						Layer.provide(
							Layer.succeed(Bookings, {
								...bookingsAt(state),
								list: Effect.tap(Ref.get(state), () => Queue.offer(initial, undefined))
							})
						),
						Layer.provide(Layer.succeed(HttpClient.HttpClient, client))
					)
				),
				Tracker
			)
			yield* Queue.take(initial)
			yield* Ref.set(state, [train])
			const lookup = yield* Effect.forkScoped(Effect.exit(tracker.refresh(train.id)))
			yield* TestClock.adjust('5 seconds')
			const result = yield* Fiber.join(lookup)
			assert.strictEqual(yield* Ref.get(calls), 3)
			assert.isTrue(Exit.hasFails(result), Exit.match(result, {onFailure: Cause.pretty, onSuccess: () => 'no failure'}))
			assert.isUndefined(yield* store.get('aeroapi'))
		})
	)
})
