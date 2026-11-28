import {Effect, Schema, Stream, String} from 'effect'

import {Tool, Toolkit} from 'effect/ai'
import {HttpRouter, HttpServerRequest} from 'effect/http'

import {AuthError, CurrentUser} from '@deslop/runtime/shared/auth'

import {AiProvider, AiProxyRpcs} from './contract.ts'
import {AiProxy} from './server.ts'

export const aiProxyTools = Toolkit.make(
	Tool.make('remove_ai_key', {
		dependencies: [CurrentUser],
		description:
			'Use when the user asks to remove their OpenCode, Anthropic or OpenAI credential; stops their calls using that key.',
		failure: AuthError,
		parameters: Schema.Struct({provider: AiProvider}),
		success: Schema.Struct({provider: AiProvider})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true)
)

export const aiProxyToolHandlers = aiProxyTools.toLayer(
	Effect.map(AiProxy, ai => ({
		remove_ai_key: Effect.fnUntraced(function* (input) {
			yield* ai.removeKey((yield* CurrentUser).id, input.provider)
			return {provider: input.provider}
		})
	}))
)

export const aiProxyHandlers = AiProxyRpcs.toLayer(
	Effect.gen(function* () {
		const ai = yield* AiProxy
		return AiProxyRpcs.of({
			'ai-proxy.key': () => Stream.unwrap(Effect.map(CurrentUser, user => ai.key(user.id))),
			'ai-proxy.setKey': Effect.fnUntraced(function* (input) {
				yield* ai.setKey((yield* CurrentUser).id, input)
			})
		})
	})
)

export const aiProxyHttp = HttpRouter.use(router =>
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
