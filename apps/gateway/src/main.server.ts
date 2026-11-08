import {NodeHttpClient} from '@effect/platform-node'

import {Array, Clock, Effect, Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'

import * as CliRuntime from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import {AiHttpHandlers} from '#http/ai.ts'
import {HttpHandlers} from '#http/handlers.ts'
import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {AiProxy} from '#services/ai/service.ts'
import {connectionStatus, summary} from '#services/connections/lib/utils.ts'
import {Connections} from '#services/connections/service.ts'
import {Gateway, GatewayDiscovery} from '#services/gateway/service.ts'
import {layerUpstream} from '#services/network/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

// Upstream servers and their providers are reached only at public HTTPS addresses. The registry is the memoized one layerMcp serves.
const layerServices = pipe(
	Layer.mergeAll(Gateway.layer, pipe(AiProxy.layer, Layer.provide(NodeHttpClient.layerUndici))),
	Layer.provide(McpServer.McpServer.layer),
	Layer.provideMerge(Connections.layer),
	Layer.provide(Layer.mergeAll(ServerRuntime.layerDataStore, layerUpstream))
)

CliRuntime.runApp({
	icon,
	routes: pipe(
		Layer.mergeAll(
			HttpHandlers,
			AiHttpHandlers,
			ServerRuntime.layerRpc({group: RpcContracts, handlers: RpcHandlers}),
			// The instructions name each connected server by the first sentence of its own, read when the gateway starts.
			Layer.unwrap(
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
		),
		Layer.provide(layerServices)
	),
	settings: {GITHUB_ADMINS: CliRuntime.ADMINS}
})
