import {ByteSize, Layer} from 'effect'

import {runApp} from '@deslop/runtime/server/cli'
import {layerRpc} from '@deslop/runtime/server/http'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Presence} from '#services/presence/service.ts'

runApp({
	icon,
	// Anyone may open the room's socket, and its largest frame, a join, is a few hundred bytes.
	maxFrameSize: ByteSize.kibibytes(4),
	routes: Layer.provide(layerRpc({disableTracing: true, group: RpcContracts, handlers: RpcHandlers}), Presence.layer)
})
