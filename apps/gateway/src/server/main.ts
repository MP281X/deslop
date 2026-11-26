import {Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {FetchHttpClient} from 'effect/http'

import {runApp} from '@deslop/runtime/server/cli'
import {layerRpc} from '@deslop/runtime/server/http'

import {GatewayRpcs} from '#contracts'

import {AiMeteringHandlers} from '#server/ai-metering/rpcs.ts'
import {AiProxyHttp} from '#server/ai-proxy/http.ts'
import {AiProxyHandlers} from '#server/ai-proxy/rpcs.ts'
import {AiProxy} from '#server/ai-proxy/service.ts'
import {ConnectionHttp} from '#server/connections/http.ts'
import {ConnectionHandlers} from '#server/connections/rpcs.ts'
import {Connections} from '#server/connections/service.ts'
import {Gateway} from '#server/gateway/service.ts'
import {GatewayMcp} from '#server/gateway/tools.ts'
import {layerUpstream} from '#server/network/service.ts'
import {Upstreams} from '#server/upstreams/service.ts'
import {Usage} from '#server/usage/service.ts'
import icon from '#web/icon.svg'

// Upstream servers and their providers are reached only at public HTTPS addresses. The registry is the memoized one layerMcp serves.
const layerServices = pipe(
	Layer.mergeAll(Gateway.layer, Layer.provide(AiProxy.layer, FetchHttpClient.layer)),
	Layer.provide(McpServer.McpServer.layer),
	Layer.provideMerge(Connections.layer),
	Layer.provide(Upstreams.layer),
	Layer.provide(layerUpstream)
)

runApp({
	icon,
	routes: Layer.mergeAll(
		Layer.provide(
			Layer.mergeAll(
				AiProxyHttp,
				ConnectionHttp,
				layerRpc({
					group: GatewayRpcs,
					handlers: Layer.mergeAll(AiProxyHandlers, AiMeteringHandlers, ConnectionHandlers)
				}),
				GatewayMcp
			),
			layerServices
		),
		Usage.layer
	)
})
