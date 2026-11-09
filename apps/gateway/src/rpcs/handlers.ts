import {Effect, Stream} from 'effect'

import {CurrentUser} from '@deslop/runtime/auth/utils'

import {RpcContracts} from '#rpcs/contracts.ts'
import {AiProxy} from '#services/ai/service.ts'
import {Connections} from '#services/connections/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const connections = yield* Connections
		const ai = yield* AiProxy
		return RpcContracts.of({
			'ai.keys': Effect.fnUntraced(function* () {
				return yield* ai.keys((yield* CurrentUser).id)
			}),
			'ai.setKey': Effect.fnUntraced(function* (input) {
				yield* ai.setKey((yield* CurrentUser).id, input.provider, input.secret)
			}),
			'ai.usage': Effect.fnUntraced(function* (input) {
				return yield* ai.usage((yield* CurrentUser).id, input)
			}),
			'gateway.add': Effect.fnUntraced(function* (input, options) {
				return yield* connections.add(input.url, yield* CurrentUser, options.headers)
			}),
			'gateway.servers': () => Stream.unwrap(Effect.map(CurrentUser, connections.watch)),
			'gateway.usage': Effect.fnUntraced(function* (input) {
				return yield* connections.usage(input)
			})
		})
	})
)
