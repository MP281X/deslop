import {Layer} from 'effect'

import {runApp} from '@deslop/runtime/server/cli'
import {layerRpc} from '@deslop/runtime/server/http'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Chapters} from '#services/chapters/service.ts'
import {Reading} from '#services/reading/service.ts'

runApp({
	icon,
	routes: Layer.provide(
		layerRpc({group: RpcContracts, handlers: RpcHandlers}),
		Layer.merge(Chapters.layer, Reading.layer)
	)
})
