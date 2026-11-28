import {Layer, pipe} from 'effect'

import {McpServer, Toolkit} from 'effect/ai'
import {FetchHttpClient} from 'effect/http'

import {runApp} from '@deslop/runtime/server/cli'
import {layerMcp, layerRpc} from '@deslop/runtime/server/http'

import {RpcContracts} from '#contracts'

import {aiMeteringHandlers} from '#ai-metering/handlers.ts'
import {aiProxyHandlers, aiProxyHttp, aiProxyToolHandlers, aiProxyTools} from '#ai-proxy/handlers.ts'
import {AiProxy} from '#ai-proxy/server.ts'
import {connectionsHandlers, connectionsToolHandlers, connectionsTools} from '#connections/handlers.ts'
import {Connections} from '#connections/server.ts'
import {gatewayHttp} from '#gateway/handlers.ts'
import {Gateway} from '#gateway/server.ts'
import {grantsHttp} from '#grants/handlers.ts'
import {Grants} from '#grants/server.ts'
import {layerUpstream} from '#network/server.ts'
import {Upstreams} from '#upstreams/server.ts'
import {Usage} from '#usage/server.ts'
import icon from '#web/icon.svg'

const toolkit = Toolkit.merge(connectionsTools, aiProxyTools)

// Upstream servers and their providers are reached only at public HTTPS addresses. The registry is the memoized one layerMcp serves.
const layerServices = pipe(
	Layer.mergeAll(Gateway.layer, Layer.provide(AiProxy.layer, FetchHttpClient.layer)),
	Layer.provide(McpServer.McpServer.layer),
	Layer.provideMerge(Grants.layer),
	Layer.provideMerge(Connections.layer),
	Layer.provide(Upstreams.layer),
	Layer.provide(layerUpstream)
)

runApp({
	icon,
	routes: Layer.mergeAll(
		Layer.provide(
			Layer.mergeAll(
				aiProxyHttp,
				grantsHttp,
				layerRpc({
					group: RpcContracts,
					handlers: Layer.mergeAll(aiProxyHandlers, aiMeteringHandlers, connectionsHandlers)
				}),
				pipe(
					layerMcp({
						contracts: toolkit,
						instructions:
							'Tools use <server>__<tool>. Use list_mcp_connections for missing or failing tools; name a server to read its full instructions.',
						registrations: Layer.provide(
							McpServer.toolkit(toolkit),
							Layer.merge(connectionsToolHandlers, aiProxyToolHandlers)
						)
					}),
					Layer.provide(gatewayHttp.layer),
					Layer.provide(McpServer.McpServer.layer)
				)
			),
			layerServices
		),
		Usage.layer
	)
})
