import {NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {HttpRouter} from 'effect/http'
import {RpcServer} from 'effect/rpc'

import {Issuer} from '@deslop/auth/service'
import * as ServerRuntime from '@deslop/runtime/server'

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(
			pipe(
				Layer.merge(
					pipe(
						RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
						Layer.provide(RpcHandlers)
					),
					ServerRuntime.layerStaticFiles
				),
				Layer.provide(Issuer.layer({redirects: []}))
			),
			{disableLogger: true}
		),
		Layer.provide(Layer.mergeAll(NodeHttpClient.layerFetch, NodeServices.layer)),
		Layer.provide(ServerRuntime.layer('@deslop/auth-server')),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
