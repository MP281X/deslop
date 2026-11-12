import {Layer, pipe} from 'effect'

import {RpcSerialization} from 'effect/rpc'

import * as CliRuntime from '@deslop/runtime/server/cli'
import * as ServerRuntime from '@deslop/runtime/server/http'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Chapters} from '#services/chapters/service.ts'

CliRuntime.runApp({
	icon,
	routes: pipe(
		ServerRuntime.layerRpc({group: RpcContracts, handlers: RpcHandlers}),
		Layer.provide(RpcSerialization.layerJson),
		Layer.provide(Chapters.layer)
	)
})
