import {Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {FetchHttpClient} from 'effect/http'

import * as CliRuntime from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import {AiHttpHandlers, HttpHandlers} from '#http/handlers.ts'
import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {AiProxy} from '#services/ai/service.ts'
import {Connections} from '#services/connections/service.ts'
import {GatewayMcp} from '#services/gateway/mcp.ts'
import {Gateway} from '#services/gateway/service.ts'
import {layerUpstream} from '#services/network/service.ts'

// Upstream servers and their providers are reached only at public HTTPS addresses. The registry is the memoized one layerMcp serves.
const layerServices = pipe(
	Layer.mergeAll(Gateway.layer, pipe(AiProxy.layer, Layer.provide(FetchHttpClient.layer))),
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
			GatewayMcp
		),
		Layer.provide(layerServices)
	),
	settings: {GITHUB_ADMINS: CliRuntime.ADMINS}
})
