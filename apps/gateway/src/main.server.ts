import {Layer, pipe} from 'effect'

import {RpcServer} from 'effect/rpc'

import * as CliRuntime from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import {HttpHandlers} from '#http/handlers.ts'
import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Connections} from '#services/connections/service.ts'
import {Gateway} from '#services/gateway/service.ts'
import {layerUpstream} from '#services/network/service.ts'
import {layerMcp} from '#tools/handlers.ts'

// Upstream servers and their providers are reached only at public HTTPS addresses.
const layerServices = pipe(
	Gateway.layer,
	Layer.provideMerge(Connections.layer),
	Layer.provide(Layer.mergeAll(ServerRuntime.layerDataStore, layerUpstream))
)

CliRuntime.runApp({
	icon,
	routes: pipe(
		Layer.mergeAll(
			HttpHandlers,
			pipe(
				RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
				Layer.provide(RpcHandlers)
			),
			layerMcp
		),
		Layer.provide(layerServices)
	),
	settings: {GITHUB_ADMINS: CliRuntime.ADMINS}
})
