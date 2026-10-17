import {NodeRuntime} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {HttpRouter} from 'effect/http'
import {RpcServer} from 'effect/rpc'

import * as ServerRuntime from '@deslop/runtime/server'

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(
			Layer.merge(
				pipe(
					RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
					Layer.provide(RpcHandlers)
				),
				ServerRuntime.layerStaticFiles
			),
			{disableLogger: true}
		),
		Layer.provide(ServerRuntime.layer('@deslop/portfolio')),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
