import {Array, Clock, Effect, Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'

import * as ServerRuntime from '@deslop/runtime/server'

import {connectionStatus, summary} from '#services/connections/lib/utils.ts'
import {Connections} from '#services/connections/service.ts'
import {GatewayDiscovery} from '#services/gateway/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

export const GatewayMcp = Layer.unwrap(
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
				registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers))
			}),
			Layer.provide(GatewayDiscovery.layer),
			Layer.provide(McpServer.McpServer.layer)
		)
	})
)
