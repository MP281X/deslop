import {Array, Effect, Equal, Layer, Option, Struct, pipe} from 'effect'

import {McpServer} from 'effect/ai'

import {Auth} from '@deslop/runtime/server/auth'
import {layerMcp} from '@deslop/runtime/server/http'
import {AuthError, CurrentUser} from '@deslop/runtime/shared/auth'

import {AiProxy} from '#services/ai-proxy/service.ts'
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
				const all = yield* connections.definitions
				if (Option.exists(input.server, id => !Array.some(all, server => server.id === id))) {
					return yield* AuthError.make({
						message: `Unknown server ${Option.getOrThrow(input.server)}; valid servers: ${pipe(
							all,
							Array.map(server => server.id),
							Array.join(', ')
						)}. Nothing changed.`
					})
				}
				return {
					servers: pipe(
						all,
						Array.filter(server => Option.match(input.server, {onNone: () => true, onSome: id => server.id === id})),
						Array.map(server => ({
							error: server.error,
							instructions: Option.filter(server.instructions, () => Option.contains(input.server, server.id)),
							...Struct.pick(server, ['id', 'status', 'tools'])
						}))
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
			user: Effect.fnUntraced(function* (headers) {
				const saved = yield* VerifiedCaller
				if (Option.exists(saved, value => Equal.equals(value.key, Option.fromUndefinedOr(headers['authorization'])))) {
					return yield* Effect.fromResult(Option.getOrThrow(saved).result)
				}
				return yield* auth.user(headers)
			})
		})
		return pipe(
			layerMcp({
				instructions:
					'Tools use <server>__<tool>. Use list_mcp_connections for missing or failing tools; name a server to read its full instructions.',
				registrations: Layer.provide(McpServer.toolkit(ToolContracts), ToolHandlers)
			}),
			Layer.provide(GatewayDiscovery.layer),
			Layer.provide(McpServer.McpServer.layer),
			Layer.provide(Layer.succeed(Auth, cached))
		)
	})
)
