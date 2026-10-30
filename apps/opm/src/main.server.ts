import {NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {HttpRouter} from 'effect/http'
import {RpcSerialization, RpcServer} from 'effect/rpc'

import {Auth} from '@deslop/runtime/auth/service'
import * as ServerRuntime from '@deslop/runtime/server'

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {layerChapters} from '#services/chapters/service.ts'

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(
			pipe(
				RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
				Layer.provide(RpcHandlers),
				Layer.provide(RpcSerialization.layerJson),
				Layer.provide(Auth.layer('https://opm.mp281x.xyz'))
			),
			{disableLogger: true}
		),
		Layer.provide(layerChapters),
		Layer.provide(Layer.mergeAll(NodeHttpClient.layerFetch, NodeServices.layer)),
		Layer.provide(ServerRuntime.layer('@deslop/opm')),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
