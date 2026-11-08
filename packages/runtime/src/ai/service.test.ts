import {NodeCrypto} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {ConfigProvider, Context, Effect, Layer, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {AiGateway, AiUnavailable} from '#ai/service.ts'
import {Sessions} from '#auth/sessions.ts'

it.effect(
	'fails without --gateway and leaves local requests unauthenticated',
	Effect.fnUntraced(function* () {
		const client = HttpClient.make(request =>
			Effect.succeed(
				HttpClientResponse.fromWeb(request, Response.json({authorization: request.headers['authorization'] ?? ''}))
			)
		)
		const context = yield* Layer.build(
			pipe(
				AiGateway.layer,
				Layer.provide(Sessions.layer),
				Layer.provide(
					Layer.mergeAll(KeyValueStore.layerMemory, NodeCrypto.layer, Layer.succeed(HttpClient.HttpClient, client))
				),
				Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({APP_URL: 'http://localhost:3000'})))
			)
		)
		const gateway = Context.get(context, AiGateway)
		assert.instanceOf(yield* Effect.flip(gateway.apiUrl('anthropic')), AiUnavailable)
		assert.deepEqual(
			yield* (yield* (yield* gateway.authorize('anyone'))(client).get('http://localhost/ai/anthropic')).json,
			{authorization: ''}
		)
	})
)
