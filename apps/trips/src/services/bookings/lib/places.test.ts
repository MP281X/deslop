import {assert, it} from '@effect/vitest'

import {Array, Boolean, Context, Effect, Exit, Fiber, Layer, Option, Ref, Schema} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {TestClock} from 'effect/testing'

import {Places} from './places.ts'

import {BookedPlace, Place} from '#services/bookings/schema.ts'

it.layer(Layer.empty)(test => {
	test.effect(
		'retries the airport list after a failure, keeps it a month, then fetches it again',
		Effect.fnUntraced(function* () {
			const available = yield* Ref.make(false)
			const calls = yield* Ref.make(0)
			const name = yield* Ref.make('Rome')
			const client = HttpClient.make(request =>
				Effect.gen(function* () {
					yield* Ref.update(calls, count => count + 1)
					return HttpClientResponse.fromWeb(
						request,
						Response.json(
							{
								LIRF: {
									city: 'Rome',
									iata: 'FCO',
									icao: 'LIRF',
									lat: 41.8,
									lon: 12.2,
									name: yield* Ref.get(name),
									tz: 'Europe/Rome'
								}
							},
							{status: Boolean.match(yield* Ref.get(available), {onFalse: () => 503, onTrue: () => 200})}
						)
					)
				})
			)
			const places = Context.get(
				yield* Layer.build(Layer.provide(Places.layer, Layer.succeed(HttpClient.HttpClient, client))),
				Places
			)
			const first = yield* Effect.forkScoped(Effect.exit(places.airport('FCO')))
			yield* TestClock.adjust('10 seconds')
			assert.isTrue(Exit.hasFails(yield* Fiber.join(first)))
			yield* Ref.set(available, true)
			assert.strictEqual((yield* places.airport('FCO')).name, 'Rome')
			const fetched = yield* Ref.get(calls)
			assert.strictEqual((yield* Schema.encodeEffect(BookedPlace)(yield* places.airport(' fco '))).code, 'FCO')
			assert.strictEqual(yield* Ref.get(calls), fetched)
			yield* Ref.set(name, 'Fiumicino')
			yield* TestClock.adjust('30 days')
			assert.strictEqual((yield* places.airport('FCO')).name, 'Fiumicino')
			assert.strictEqual(yield* Ref.get(calls), fetched + 1)
		})
	)
	test.effect(
		'shares station requests without caching a lookup failure or an empty provider answer',
		Effect.fnUntraced(function* () {
			const mode = yield* Ref.make<'offline' | 'empty' | 'match'>('offline')
			const calls = yield* Ref.make(0)
			const client = HttpClient.make(request =>
				Effect.gen(function* () {
					yield* Ref.update(calls, count => count + 1)
					yield* Effect.yieldNow
					return HttpClientResponse.fromWeb(
						request,
						Response.json(
							Boolean.match((yield* Ref.get(mode)) === 'match', {
								onFalse: () => [],
								onTrue: () => [
									{
										id: 'rail:8308003',
										lat: 41.9,
										lon: 12.5,
										modes: ['HIGHSPEED_RAIL'],
										name: 'ROMA TERMINI',
										tz: 'Europe/Rome'
									}
								]
							}),
							{status: Boolean.match((yield* Ref.get(mode)) === 'offline', {onFalse: () => 200, onTrue: () => 503})}
						)
					)
				})
			)
			const places = Context.get(
				yield* Layer.build(Layer.provide(Places.layer, Layer.succeed(HttpClient.HttpClient, client))),
				Places
			)
			assert.isTrue(Exit.hasFails(yield* Effect.exit(places.station('Roma Termini'))))
			yield* Ref.set(mode, 'empty')
			assert.deepStrictEqual(yield* places.station('Roma Termini'), Option.none())
			yield* Ref.set(mode, 'match')
			assert.deepStrictEqual(
				Array.map(
					yield* Effect.all([places.station('Roma Termini'), places.station('Roma Termini')], {
						concurrency: 'unbounded'
					}),
					place => Option.map(place, found => Schema.encodeSync(Place)(found).code)
				),
				[Option.some('rail:8308003'), Option.some('rail:8308003')]
			)
			assert.strictEqual(yield* Ref.get(calls), 3)
			yield* places.station(' roma termini ')
			assert.strictEqual(yield* Ref.get(calls), 3)
		})
	)
})
