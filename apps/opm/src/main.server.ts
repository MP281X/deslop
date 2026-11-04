import {Layer, pipe} from 'effect'

import {RpcSerialization} from 'effect/rpc'

import * as CliRuntime from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {layerChapters} from '#services/chapters/service.ts'

CliRuntime.runApp({
	icon,
	routes: pipe(
		ServerRuntime.layerRpc({group: RpcContracts, handlers: RpcHandlers}),
		Layer.provide(RpcSerialization.layerJson),
		Layer.provide(layerChapters)
	)
})
