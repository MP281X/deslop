import {Effect, Stream} from 'effect'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {AiProxy} from '#services/ai-proxy/service.ts'
import {Connections} from '#services/connections/service.ts'
import {Gateway} from '#services/gateway/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const connections = yield* Connections
		const gateway = yield* Gateway
		const ai = yield* AiProxy
		return RpcContracts.of({
			'ai-proxy.list': Effect.fnUntraced(function* () {
				return yield* ai.list((yield* CurrentUser).id)
			}),
			'ai-proxy.setKey': Effect.fnUntraced(function* (input) {
				yield* ai.setKey((yield* CurrentUser).id, input.provider, input.secret)
			}),
			'ai-proxy.usage': period => Stream.unwrap(Effect.map(CurrentUser, user => ai.usage(user.id, period))),
			'connections.add': Effect.fnUntraced(function* (input, options) {
				const added = yield* connections.add(input.url, yield* CurrentUser, options.headers)
				// A new server's tools are read now, so its first list is not empty.
				yield* gateway.connected(options.headers)
				return added
			}),
			'connections.usage': period => connections.usage(period),
			'connections.watch': () => Stream.unwrap(Effect.map(CurrentUser, connections.watch))
		})
	})
)
