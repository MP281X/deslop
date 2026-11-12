import {Layer, pipe} from 'effect'

import * as CliRuntime from '@deslop/runtime/server/cli'
import * as ServerRuntime from '@deslop/runtime/server/http'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Presence} from '#services/presence/service.ts'

CliRuntime.runApp({
	icon,
	routes: pipe(
		// Every visitor sends a move each 50 ms; a span per move would bury Scope.
		ServerRuntime.layerRpc({disableTracing: true, group: RpcContracts, handlers: RpcHandlers}),
		Layer.provide(Presence.layer)
	)
})
