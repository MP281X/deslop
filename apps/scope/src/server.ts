import {Layer} from 'effect'

import {McpServer, Toolkit} from 'effect/ai'

import {runApp} from '@deslop/runtime/server/cli'
import {layerMcp, layerRpc} from '@deslop/runtime/server/http'

import {githubActionsHttp} from '#github-actions/handlers.ts'
import {ingestionHttp, ingestionToolHandlers, ingestionTools} from '#ingestion/handlers.ts'
import {Ingestion} from '#ingestion/server.ts'
import {searchToolHandlers, searchTools} from '#search/handlers.ts'
import {Search} from '#search/server.ts'
import {TelemetryRpcs} from '#telemetry/contract.ts'
import {telemetryHandlers} from '#telemetry/handlers.ts'
import {Telemetry} from '#telemetry/server.ts'
import icon from '#web/icon.svg'

const toolkit = Toolkit.merge(searchTools, ingestionTools)

const layerServices = Layer.provideMerge(Layer.mergeAll(Search.layer, Ingestion.layer), Telemetry.layer)

// The receiver never exports its own spans or query traffic back into itself.
runApp({
	icon,
	routes: Layer.provide(
		Layer.mergeAll(
			ingestionHttp,
			githubActionsHttp,
			layerRpc({group: TelemetryRpcs, handlers: telemetryHandlers}),
			layerMcp({
				contracts: toolkit,
				instructions:
					'For an overview use list_operations; if you have a trace id, read_trace directly. search_traces finds individual requests and search_logs finds uncorrelated causes.',
				registrations: Layer.provide(McpServer.toolkit(toolkit), Layer.merge(searchToolHandlers, ingestionToolHandlers))
			})
		),
		layerServices
	),
	telemetry: false
})
