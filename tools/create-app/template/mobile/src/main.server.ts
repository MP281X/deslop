import {NodeRuntime} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {HttpRouter} from 'effect/http'
import {RpcSerialization, RpcServer} from 'effect/rpc'

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import * as ServerRuntime from '@deslop/runtime/server'

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(
			pipe(
				RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
				Layer.provide(RpcHandlers),
				Layer.provide(RpcSerialization.layerJson)
			),
			{disableLogger: true}
		),
		Layer.provide(ServerRuntime.layer('@deslop/template-app')),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
