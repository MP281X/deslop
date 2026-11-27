import {Effect, Stream} from 'effect'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {AiProxyRpcs} from '#contracts'

import {AiProxy} from '#server/ai-proxy/service.ts'

export const AiProxyHandlers = AiProxyRpcs.toLayer(
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
