import {Layer} from 'effect'

import {McpServer} from 'effect/ai'

import {runApp} from '@deslop/runtime/server/cli'
import {layerMcp, layerRpc} from '@deslop/runtime/server/http'

import {HttpHandlers} from '#http/handlers.ts'
import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Telemetry} from '#services/telemetry/service.ts'
import {ToolContracts} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

// The receiver never exports its own spans or query traffic back into itself.
runApp({
	icon,
	routes: Layer.provide(
		Layer.mergeAll(
			HttpHandlers,
			layerRpc({group: RpcContracts, handlers: RpcHandlers}),
			layerMcp({
				instructions:
					'For an overview use list_operations; if you have a trace id, read_trace directly. find_traces finds individual requests and search_logs finds uncorrelated causes.',
				registrations: Layer.provide(McpServer.toolkit(ToolContracts), ToolHandlers)
			})
		),
		Telemetry.layer
	),
	telemetry: false
})
