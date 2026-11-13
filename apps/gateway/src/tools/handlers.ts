import {Array, Clock, Effect, Layer, Option, Struct, pipe} from 'effect'

import {McpServer} from 'effect/ai'

import {Auth} from '@deslop/runtime/server/auth'
import {layerMcp} from '@deslop/runtime/server/http'
import {AuthError, CurrentUser} from '@deslop/runtime/shared/auth'

import {AiProxy} from '#services/ai/service.ts'
import {connectionStatus} from '#services/connections/lib/utils.ts'
import {Connections} from '#services/connections/service.ts'
import {Gateway, GatewayDiscovery, VerifiedCaller} from '#services/gateway/service.ts'
import {ToolContracts} from '#tools/contracts.ts'

const ToolHandlers = ToolContracts.toLayer(
	Effect.gen(function* () {
		const ai = yield* AiProxy
		const connections = yield* Connections
		const gateway = yield* Gateway
		return ToolContracts.of({
			list_mcp_connections: Effect.fnUntraced(function* (input) {
				const now = yield* Clock.currentTimeMillis
				const all = yield* connections.definitions
				if (input.server !== undefined && !Array.some(all, server => server.id === input.server)) {
					return yield* AuthError.make({
						message: `Unknown server ${input.server}; valid servers: ${Array.join(
							Array.map(all, server => server.id),
							', '
						)}. Nothing changed.`
					})
				}
				return {
					servers: Array.map(
						Array.filter(all, server => input.server === undefined || server.id === input.server),
						server => ({
							...Struct.pick(server, ['error', 'id']),
							...Option.match(
								Option.filter(Option.fromUndefinedOr(server.instructions), () => input.server === server.id),
								{onNone: () => ({}), onSome: instructions => ({instructions})}
							),
							status: connectionStatus(server, now),
							tools: Array.length(server.tools)
						})
					)
				}
			}),
			remove_ai_key: Effect.fnUntraced(function* (input) {
				yield* ai.removeKey((yield* CurrentUser).id, input.provider)
				return {provider: input.provider}
			}),
			remove_mcp_server: Effect.fnUntraced(function* (input) {
				yield* connections.remove(input.server, yield* CurrentUser)
				yield* gateway.removed
				return {server: input.server}
			})
		})
	})
)

export const GatewayMcp = Layer.unwrap(
	Effect.gen(function* () {
		const auth = yield* Auth
		// One tools/list verifies its bearer in the discovery middleware; the MCP auth middleware reads the same answer.
		const cached = Auth.of({
			token: headers => auth.token(headers),
			user: headers =>
				Effect.gen(function* () {
					const saved = Option.getOrUndefined(yield* VerifiedCaller)
					if (saved?.key === (headers['authorization'] ?? '')) return yield* Effect.fromResult(saved.result)
					return yield* auth.user(headers)
				})
		})
		return pipe(
			layerMcp({
				instructions:
					'Tools use <server>__<tool>. Use list_mcp_connections for missing or failing tools; name a server to read its full instructions.',
				registrations: pipe(McpServer.toolkit(ToolContracts), Layer.provide(ToolHandlers))
			}),
			Layer.provide(GatewayDiscovery.layer),
			Layer.provide(McpServer.McpServer.layer),
			Layer.provide(Layer.succeed(Auth, cached))
		)
	})
)
