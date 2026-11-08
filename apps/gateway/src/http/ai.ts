import {Effect, Schema} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {AiProvider} from '#services/ai/schema.ts'
import {AiProxy} from '#services/ai/service.ts'

export const AiHttpHandlers = HttpRouter.use(router =>
	Effect.gen(function* () {
		const ai = yield* AiProxy
		yield* router.add('POST', '/ai/grants', ai.mint)
		yield* router.add(
			'*',
			'/ai/:provider/*',
			Effect.gen(function* () {
				const params = yield* HttpRouter.params
				const provider = Schema.decodeUnknownOption(AiProvider)(params['provider'])
				if (provider._tag === 'None') {
					return HttpServerResponse.jsonUnsafe({error: {message: 'Unknown AI provider'}}, {status: 404})
				}
				return yield* ai.proxy(
					provider.value,
					(yield* HttpServerRequest.HttpServerRequest).url.slice(`/ai/${provider.value}/`.length)
				)
			})
		)
	})
)
