import {Effect, Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'

import * as CliRuntime from '@deslop/runtime/server/cli'
import * as ServerRuntime from '@deslop/runtime/server/http'
import {dataDirectory} from '@deslop/runtime/server/store'

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
				instructions:
					"Scope is the debugger for the user's Effect apps: start with list_operations to see what is failing or slow, then read_trace for one trace's spans and logs.",
				registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers))
			})
		),
		Layer.provide(Layer.unwrap(Effect.map(dataDirectory, directory => Telemetry.layer(`${directory}/entries`))))
	),
	telemetry: false
})
