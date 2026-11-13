import {Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {FetchHttpClient} from 'effect/http'

import {ADMINS, runApp} from '@deslop/runtime/server/cli'
import {layerRpc} from '@deslop/runtime/server/http'

import {AiHttpHandlers, HttpHandlers} from '#http/handlers.ts'
import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {AiProxy} from '#services/ai-proxy/service.ts'
import {Connections} from '#services/connections/service.ts'
import {Gateway} from '#services/gateway/service.ts'
import {layerUpstream} from '#services/network/service.ts'
import {Upstreams} from '#services/upstreams/service.ts'
import {GatewayMcp} from '#tools/handlers.ts'

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
	routes: Layer.provide(
		Layer.mergeAll(HttpHandlers, AiHttpHandlers, layerRpc({group: RpcContracts, handlers: RpcHandlers}), GatewayMcp),
		layerServices
	),
	settings: {GITHUB_ADMINS: ADMINS}
})
