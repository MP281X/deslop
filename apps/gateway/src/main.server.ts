import {NodeCrypto, NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {HttpRouter} from 'effect/http'
import {RpcServer} from 'effect/rpc'

import {Auth} from '@deslop/runtime/auth/service'
import * as ServerRuntime from '@deslop/runtime/server'

import {HttpHandlers} from '#http/handlers.ts'
import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {GATEWAY_URL} from '#services/connections/lib/utils.ts'
import {Connections} from '#services/connections/service.ts'
import {Gateway} from '#services/gateway/service.ts'
import {layerUpstream} from '#services/network/service.ts'
import {layerMcp} from '#tools/handlers.ts'

// Upstream servers and their providers are reached only at public HTTPS addresses; Auth stays on the deploy's own network.
const layerServices = pipe(
	Gateway.layer,
	Layer.provideMerge(Connections.layer),
	Layer.provide(Layer.mergeAll(NodeCrypto.layer, NodeServices.layer, layerUpstream))
)

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(
			pipe(
				Layer.mergeAll(
					HttpHandlers,
					pipe(
						RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
						Layer.provide(RpcHandlers)
					),
					layerMcp,
					ServerRuntime.layerIcon(icon),
					ServerRuntime.layerStaticFiles
				),
				Layer.provide(layerServices),
				Layer.provide(Auth.layer(GATEWAY_URL))
			),
			{disableLogger: true}
		),
		Layer.provide(ServerRuntime.layer('@deslop/gateway')),
		Layer.provide(NodeHttpClient.layerFetch),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
