import {Array, Clock, Effect, Layer, Option, Struct, pipe} from 'effect'

import {McpServer} from 'effect/ai'

import * as ServerRuntime from '@deslop/runtime/server'

import packageJson from '#package.json' with {type: 'json'}

import {connectionStatus, summary} from '#services/connections/lib/utils.ts'
import {Connections} from '#services/connections/service.ts'
import {GatewayDiscovery} from '#services/gateway/service.ts'
import {Tools} from '#tools/contracts.ts'

const ToolHandlers = Tools.toLayer(
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
						tools: Array.length(Array.filter(server.tools, tool => !Array.contains(server.hidden, tool)))
					}))
				}
			})
		})
	})
)

// The instructions name each connected server by the first sentence of its own, read when the gateway starts.
export const layerMcp = Layer.unwrap(
	Effect.gen(function* () {
		const now = yield* Clock.currentTimeMillis
		return pipe(
			ServerRuntime.layerMcp({
				instructions: Array.join(
					[
						"Gateway to the user's MCP servers; tools are named <server>__<tool>.",
						...Array.map(
							Array.filter(
								yield* (yield* Connections).definitions,
								server => connectionStatus(server, now) === 'Connected'
							),
							server => `${server.id}: ${summary(server)}`
						),
						'If a tool is missing or failing, list_mcp_connections says why.'
					],
					'\n'
				),
				name: 'gateway',
				registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers)),
				version: packageJson.version
			}),
			Layer.provide(GatewayDiscovery.layer),
			Layer.provide(McpServer.McpServer.layer)
		)
	})
)
