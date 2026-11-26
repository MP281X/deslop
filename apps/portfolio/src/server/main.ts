import {ByteSize, Layer} from 'effect'

import {runApp} from '@deslop/runtime/server/cli'
import {layerRpc} from '@deslop/runtime/server/http'

import {RpcContracts} from '#contracts'

import {RpcHandlers} from '#server/presence/rpcs.ts'
import {Presence} from '#server/presence/service.ts'
import icon from '#web/icon.svg'

runApp({
	icon,
	// Anyone may open the room's socket, and its largest frame, a join, is a few hundred bytes.
	maxFrameSize: ByteSize.kibibytes(4),
	routes: Layer.provide(layerRpc({disableTracing: true, group: RpcContracts, handlers: RpcHandlers}), Presence.layer)
})
