import {Layer, pipe} from 'effect'

import {RpcServer} from 'effect/rpc'

import * as CliRuntime from '@deslop/runtime/cli'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Presence} from '#services/presence/service.ts'

CliRuntime.runApp({
	icon,
	routes: pipe(
		// Every visitor sends a move each 50 ms; a span per move would bury Scope.
		RpcServer.layerHttp({disableTracing: true, group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
		Layer.provide(RpcHandlers),
		Layer.provide(Presence.layer)
	)
})
