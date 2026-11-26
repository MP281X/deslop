import {Effect, String} from 'effect'

import {HttpRouter, HttpServerRequest} from 'effect/http'

import {AiProxy} from '#server/ai-proxy/service.ts'

export const AiProxyHttp = HttpRouter.use(router =>
	Effect.gen(function* () {
		const ai = yield* AiProxy
		yield* router.add(
			'*',
			'/ai/*',
			Effect.gen(function* () {
				return yield* ai.proxy(String.slice('/ai/'.length)((yield* HttpServerRequest.HttpServerRequest).url))
			})
		)
	})
)
