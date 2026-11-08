import {assert, it} from '@effect/vitest'

import {ConfigProvider, Effect, Layer, Queue, Ref, String, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {GRANT_REFUSED} from '#ai/schema.ts'
import {AiGateway, AiUnavailable} from '#ai/service.ts'

it.effect(
	'keeps the grant through a provider 401 and re-enrolls after Gateway refuses it',
	Effect.fnUntraced(function* () {
		const minted = yield* Ref.make(0)
		const client = HttpClient.make(request =>
			Effect.gen(function* () {
				if (request.url === 'https://gateway.mp281x.xyz/ai/grants') {
					return HttpClientResponse.fromWeb(
						request,
						Response.json({token: `grant-${yield* Ref.updateAndGet(minted, count => count + 1)}`})
					)
				}
				if (String.endsWith('/wrong-key')(request.url)) {
					return HttpClientResponse.fromWeb(
						request,
						Response.json({error: {message: 'invalid x-api-key'}}, {status: 401})
					)
				}
				if (request.headers['authorization'] === 'Bearer grant-1') {
					return HttpClientResponse.fromWeb(
						request,
						Response.json(
							{error: {message: 'Unknown or revoked AI grant'}},
							{headers: {[GRANT_REFUSED]: 'true'}, status: 401}
						)
					)
				}
				return HttpClientResponse.fromWeb(request, Response.json({authorization: request.headers['authorization']}))
			})
		)
		yield* pipe(
			Effect.gen(function* () {
				const gateway = yield* AiGateway
				yield* gateway.enroll('alice', Effect.succeed('alice-access'))
				const authorized = gateway.authorize('alice')(client)
				assert.equal((yield* authorized.get('https://gateway.mp281x.xyz/ai/anthropic/wrong-key')).status, 401)
				yield* gateway.enroll('alice', Effect.succeed('alice-access'))
				assert.equal(yield* Ref.get(minted), 1)
				assert.equal((yield* authorized.get('https://gateway.mp281x.xyz/ai/anthropic/v1/messages')).status, 401)
				yield* gateway.enroll('alice', Effect.succeed('alice-access'))
				assert.equal(yield* Ref.get(minted), 2)
				assert.deepEqual(yield* (yield* authorized.get('https://gateway.mp281x.xyz/ai/anthropic/v1/messages')).json, {
					authorization: 'Bearer grant-2'
				})
			}),
			// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This test entry point owns the complete Gateway service lifetime.
			Effect.provide(
				pipe(
					AiGateway.layer,
					Layer.provide(KeyValueStore.layerMemory),
					Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
					Layer.provide(
						ConfigProvider.layer(
							ConfigProvider.fromUnknown({
								APP_URL: 'https://stash.mp281x.xyz',
								AUTH_URL: 'https://auth.mp281x.xyz',
								GATEWAY_URL: 'https://gateway.mp281x.xyz'
							})
						)
					)
				)
			)
		)
	})
)

it.effect(
	'enrolls once per person and applies the stored grant at the client construction boundary',
	Effect.fnUntraced(function* () {
		const calls = yield* Queue.unbounded<string>()
		const client = HttpClient.make(request =>
			Effect.gen(function* () {
				yield* Queue.offer(calls, request.headers['authorization'] ?? '')
				return HttpClientResponse.fromWeb(request, Response.json({token: 'grant-for-alice'}))
			})
		)
		yield* pipe(
			Effect.gen(function* () {
				const gateway = yield* AiGateway
				assert.equal(yield* gateway.apiUrl('openrouter'), 'https://gateway.mp281x.xyz/ai/openrouter/v1')
				yield* gateway.enroll('alice', Effect.succeed('alice-access'))
				assert.equal(yield* Queue.take(calls), 'Bearer alice-access')
				yield* gateway.enroll('alice', Effect.die('An enrolled person needs no access token'))
				yield* gateway.authorize('alice')(client).get('https://gateway.mp281x.xyz/ai/openrouter/alpha/decisions')
				assert.equal(yield* Queue.take(calls), 'Bearer grant-for-alice')
				assert.equal(
					(yield* Effect.flip(
						gateway.authorize('bob')(client).get('https://gateway.mp281x.xyz/ai/anthropic/v1/messages')
					)).reason._tag,
					'TransportError'
				)
			}),
			// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This test entry point owns the complete Gateway service lifetime.
			Effect.provide(
				pipe(
					AiGateway.layer,
					Layer.provide(KeyValueStore.layerMemory),
					Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
					Layer.provide(
						ConfigProvider.layer(
							ConfigProvider.fromUnknown({
								APP_URL: 'https://stash.mp281x.xyz',
								AUTH_URL: 'https://auth.mp281x.xyz',
								GATEWAY_URL: 'https://gateway.mp281x.xyz'
							})
						)
					)
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
			// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This local test entry point owns the complete Gateway service lifetime.
			Effect.provide(
				pipe(
					AiGateway.layer,
					Layer.provide(KeyValueStore.layerMemory),
					Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
					Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({APP_URL: 'http://localhost:3000'})))
				)
			)
		)
	})
)
