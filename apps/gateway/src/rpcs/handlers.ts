import {Effect, Stream} from 'effect'

import {CurrentUser} from '@deslop/runtime/auth/utils'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Connections} from '#services/connections/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const connections = yield* Connections
		return RpcContracts.of({
			'gateway.add': Effect.fnUntraced(function* (input) {
				return yield* connections.add(input.url, yield* CurrentUser)
			}),
			'gateway.disconnect': Effect.fnUntraced(function* (input) {
				return yield* connections.disconnect(input.id, yield* CurrentUser)
			}),
			'gateway.hide': Effect.fnUntraced(function* (input) {
				return yield* connections.hide(input, yield* CurrentUser)
			}),
			'gateway.remove': Effect.fnUntraced(function* (input) {
				return yield* connections.remove(input.id, yield* CurrentUser)
			}),
			'gateway.servers': () => Stream.unwrap(Effect.map(CurrentUser, connections.watch))
		})
	})
)
