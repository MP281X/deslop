import {Effect, Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'

import * as CliRuntime from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import {HttpHandlers} from '#http/handlers.ts'
import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Telemetry} from '#services/telemetry/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

// The receiver never exports its own spans or query traffic back into itself.
CliRuntime.runApp({
	icon,
	routes: pipe(
		Layer.mergeAll(
			HttpHandlers,
			ServerRuntime.layerRpc({group: RpcContracts, handlers: RpcHandlers}),
			ServerRuntime.layerMcp({
				instructions: "Scope is the debugger for the user's Effect apps: their traces, spans and logs.",
				registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers))
			})
		),
		Layer.provide(
			Layer.unwrap(Effect.map(ServerRuntime.dataDirectory, directory => Telemetry.layer(`${directory}/entries`)))
		)
	),
	telemetry: false
})
