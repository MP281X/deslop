import {Array, Clock, Effect, Option, Struct} from 'effect'

import {connectionStatus} from '#services/connections/lib/utils.ts'
import {Connections} from '#services/connections/service.ts'
import {Tools} from '#tools/contracts.ts'

export const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const connections = yield* Connections
		return Tools.of({
			list_mcp_connections: Effect.fnUntraced(function* (input) {
				const now = yield* Clock.currentTimeMillis
				return {
					servers: Array.map(yield* connections.definitions, server => ({
						...Struct.pick(server, ['error', 'id']),
						...Option.match(
							Option.filter(Option.fromUndefinedOr(server.instructions), () => input.server === server.id),
							{onNone: () => ({}), onSome: instructions => ({instructions})}
						),
						status: connectionStatus(server, now),
						tools: Array.length(server.tools)
					}))
				}
			})
		})
	})
)
