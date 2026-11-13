import {Layer, pipe} from 'effect'

import * as CliRuntime from '@deslop/runtime/server/cli'
import * as ServerRuntime from '@deslop/runtime/server/http'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Chapters} from '#services/chapters/service.ts'

CliRuntime.runApp({
	icon,
	routes: pipe(ServerRuntime.layerRpc({group: RpcContracts, handlers: RpcHandlers}), Layer.provide(Chapters.layer))
})
