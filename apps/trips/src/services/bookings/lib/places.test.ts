import {assert, it} from '@effect/vitest'

import {Boolean, Context, Effect, Exit, Fiber, Layer, Ref, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'
import {TestClock} from 'effect/testing'

import {Places} from '#services/bookings/lib/places.ts'

it.layer(KeyValueStore.layerMemory)(test => {
	test.effect(
		'retries airport initialization after failure, expires saved data and keeps stale data during an outage',
		() =>
			Effect.gen(function* () {
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
					yield* Layer.build(pipe(Places.layer, Layer.provide(Layer.succeed(HttpClient.HttpClient, client)))),
					Places
				)
				const first = yield* Effect.forkScoped(Effect.exit(places.airport('FCO')))
				yield* TestClock.adjust('10 seconds')
				assert.isTrue(Exit.hasFails(yield* Fiber.join(first)))
				yield* Ref.set(available, true)
				assert.strictEqual((yield* places.airport('FCO')).name, 'Rome')
				const fetched = yield* Ref.get(calls)
				assert.strictEqual((yield* places.airport(' fco ')).code, 'FCO')
				assert.strictEqual(yield* Ref.get(calls), fetched)
				yield* Ref.set(name, 'Fiumicino')
				yield* TestClock.adjust('31 days')
				assert.strictEqual((yield* places.airport('FCO')).name, 'Fiumicino')
				assert.strictEqual(yield* Ref.get(calls), fetched + 1)
				yield* Ref.set(available, false)
				yield* TestClock.adjust('31 days')
				const stale = yield* Effect.forkScoped(places.airport('FCO'))
				yield* TestClock.adjust('10 seconds')
				assert.strictEqual((yield* Fiber.join(stale)).name, 'Fiumicino')
			})
	)
})
