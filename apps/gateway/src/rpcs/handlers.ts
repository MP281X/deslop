import {Effect, Stream} from 'effect'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {AiProxy} from '#services/ai/service.ts'
import {Connections} from '#services/connections/service.ts'
import {Gateway} from '#services/gateway/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const connections = yield* Connections
		const gateway = yield* Gateway
		const ai = yield* AiProxy
		return RpcContracts.of({
			'ai.keys': Effect.fnUntraced(function* () {
				return yield* ai.keys((yield* CurrentUser).id)
			}),
			'ai.setKey': Effect.fnUntraced(function* (input) {
				yield* ai.setKey((yield* CurrentUser).id, input.provider, input.secret)
			}),
			'ai.usage': period => Stream.unwrap(Effect.map(CurrentUser, user => ai.usage(user.id, period))),
			'gateway.add': Effect.fnUntraced(function* (input, options) {
				const added = yield* connections.add(input.url, yield* CurrentUser, options.headers)
				// A new server's tools are read now, so its first list is not empty.
				yield* gateway.connected(options.headers)
				return added
			}),
			'gateway.servers': () => Stream.unwrap(Effect.map(CurrentUser, connections.watch)),
			'gateway.usage': period => connections.usage(period)
		})
	})
)
