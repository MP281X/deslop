import {assert, it} from '@effect/vitest'

import {ConfigProvider, Effect, Layer, Queue, pipe} from 'effect'

import {Headers, HttpClient, HttpClientResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {AiGateway, AiUnavailable} from '#ai/service.ts'

it.effect(
	'enrolls once per person and applies the stored grant at the client construction boundary',
	Effect.fnUntraced(function* () {
		const calls = yield* Queue.unbounded<string>()
		const client = HttpClient.make(request =>
			Effect.gen(function* () {
				yield* Queue.offer(calls, request.headers['authorization'] ?? request.headers['cookie'] ?? '')
				return HttpClientResponse.fromWeb(request, Response.json({token: 'grant-for-alice'}))
			})
		)
		yield* pipe(
			Effect.gen(function* () {
				const gateway = yield* AiGateway
				assert.equal(yield* gateway.apiUrl('openrouter'), 'https://gateway.mp281x.xyz/ai/openrouter/v1')
				yield* gateway.enroll('alice', Headers.fromInput({cookie: 'session=alice'}))
				assert.equal(yield* Queue.take(calls), 'session=alice')
				yield* gateway.enroll('alice', Headers.fromInput({cookie: 'session=alice'}))
				yield* gateway.authorize('alice')(client).get('https://gateway.mp281x.xyz/ai/openrouter/alpha/decisions')
				assert.equal(yield* Queue.take(calls), 'Bearer grant-for-alice')
				assert.equal(
					(yield* Effect.flip(
						gateway.authorize('bob')(client).get('https://gateway.mp281x.xyz/ai/anthropic/v1/messages')
					)).reason._tag,
					'TransportError'
				)
			}),
			Effect.provide(
				pipe(
					AiGateway.layer,
					Layer.provide(KeyValueStore.layerMemory),
					Layer.provide(Layer.succeed(HttpClient.HttpClient, client))
				)
			),
			Effect.provide(
				ConfigProvider.layer(
					ConfigProvider.fromUnknown({
						APP_URL: 'https://stash.mp281x.xyz',
						AUTH_URL: 'https://auth.mp281x.xyz',
						GATEWAY_URL: 'https://gateway.mp281x.xyz'
					})
				)
			)
		)
	})
)

it.effect(
	'fails without --gateway and leaves local requests unauthenticated',
	Effect.fnUntraced(function* () {
		const client = HttpClient.make(request =>
			Effect.succeed(
				HttpClientResponse.fromWeb(request, Response.json({authorization: request.headers['authorization'] ?? ''}))
			)
		)
		yield* pipe(
			Effect.gen(function* () {
				const gateway = yield* AiGateway
				assert.instanceOf(yield* Effect.flip(gateway.apiUrl('anthropic')), AiUnavailable)
				assert.deepEqual(
					yield* (yield* gateway.authorize('anyone')(client).get('http://localhost/ai/anthropic')).json,
					{authorization: ''}
				)
			}),
			Effect.provide(
				pipe(
					AiGateway.layer,
					Layer.provide(KeyValueStore.layerMemory),
					Layer.provide(Layer.succeed(HttpClient.HttpClient, client))
				)
			),
			Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({APP_URL: 'http://localhost:3000'})))
		)
	})
)
