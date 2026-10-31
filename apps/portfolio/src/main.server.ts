import {NodeRuntime} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {HttpRouter} from 'effect/http'
import {RpcServer} from 'effect/rpc'

import * as ServerRuntime from '@deslop/runtime/server'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Presence} from '#services/presence/service.ts'

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(
			Layer.mergeAll(
				pipe(
					// Every visitor sends a move each 50 ms; a span per move would bury Scope.
					RpcServer.layerHttp({disableTracing: true, group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
					Layer.provide(RpcHandlers)
				),
				ServerRuntime.layerIcon(icon),
				ServerRuntime.layerStaticFiles
			),
			{disableLogger: true}
		),
		Layer.provide(Presence.layer),
		Layer.provide(ServerRuntime.layer('@deslop/portfolio')),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
