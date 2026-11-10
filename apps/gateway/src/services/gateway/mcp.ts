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
			Layer.provide(McpServer.McpServer.layer)
		)
	})
)
