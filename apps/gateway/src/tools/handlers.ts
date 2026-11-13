import {Array, Clock, Effect, Layer, Option, Struct, pipe} from 'effect'

import {McpServer} from 'effect/ai'

import {Auth} from '@deslop/runtime/server/auth'
import * as ServerRuntime from '@deslop/runtime/server/http'
import {CurrentUser} from '@deslop/runtime/shared/auth'

import {AiProxy} from '#services/ai/service.ts'
import {connectionStatus, summary} from '#services/connections/lib/utils.ts'
import {Connections} from '#services/connections/service.ts'
import {Gateway, GatewayDiscovery, VerifiedCaller} from '#services/gateway/service.ts'
import {Tools} from '#tools/contracts.ts'

const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const ai = yield* AiProxy
		const connections = yield* Connections
		const gateway = yield* Gateway
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
			}),
			remove_ai_key: Effect.fnUntraced(function* (input) {
				yield* ai.removeKey((yield* CurrentUser).id, input.provider)
			}),
			remove_mcp_server: Effect.fnUntraced(function* (input) {
				yield* connections.remove(input.server, yield* CurrentUser)
				yield* gateway.removed
			})
		})
	})
)

export const GatewayMcp = Layer.unwrap(
	Effect.gen(function* () {
		const now = yield* Clock.currentTimeMillis
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
			ServerRuntime.layerMcp({
				instructions: Array.join(
					[
						"Gateway holds the user's MCP servers, provider keys and AI usage; start with list_mcp_connections, and upstream tools are named <server>__<tool>.",
						...Array.map(
							Array.filter(
								yield* (yield* Connections).definitions,
								server => connectionStatus(server, now) === 'Connected'
							),
							server => `${server.id}: ${summary(server)}`
						)
					],
					'\n'
				),
				registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers))
			}),
			Layer.provide(GatewayDiscovery.layer),
			Layer.provide(McpServer.McpServer.layer),
			Layer.provide(Layer.succeed(Auth, cached))
		)
	})
)
