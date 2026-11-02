import {Layer, pipe} from 'effect'

import {RpcSerialization, RpcServer} from 'effect/rpc'

import * as CliRuntime from '@deslop/runtime/cli'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {layerChapters} from '#services/chapters/service.ts'

CliRuntime.runApp({
	icon,
	routes: pipe(
		RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
		Layer.provide(RpcHandlers),
		Layer.provide(RpcSerialization.layerJson),
		Layer.provide(layerChapters)
	)
})
