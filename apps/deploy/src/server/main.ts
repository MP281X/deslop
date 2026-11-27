import {Effect, Layer, pipe} from 'effect'

import {McpServer, Toolkit} from 'effect/ai'

import {runApp} from '@deslop/runtime/server/cli'
import {layerMcp, layerRpc} from '@deslop/runtime/server/http'
import {ToolPath} from '@deslop/runtime/server/process'
import {dataDirectory} from '@deslop/runtime/server/store'

import {RpcContracts} from '#contracts'

import {exposuresHandlers} from '#server/exposures/rpcs.ts'
import {Exposures} from '#server/exposures/service.ts'
import {exposuresToolHandlers, exposuresTools} from '#server/exposures/tools.ts'
import {inventoryHandlers} from '#server/inventory/rpcs.ts'
import {Inventory} from '#server/inventory/service.ts'
import {inventoryToolHandlers, inventoryTools} from '#server/inventory/tools.ts'
import {Machine} from '#server/machine/service.ts'
import {metricsHandlers} from '#server/metrics/rpcs.ts'
import {Metrics} from '#server/metrics/service.ts'
import {metricsToolHandlers, metricsTools} from '#server/metrics/tools.ts'
import icon from '#web/icon.svg'

const toolkit = Toolkit.merge(inventoryTools, metricsTools, exposuresTools)

const layerServices = pipe(
	Machine.layer,
	// Exposures read port owners from the inventory.
	Layer.provideMerge(Layer.unwrap(Effect.map(dataDirectory, Exposures.layer))),
	Layer.provideMerge(Layer.provideMerge(Metrics.layer, Inventory.layer)),
	Layer.provide(ToolPath.layer)
)

runApp({
	icon,
	routes: Layer.provide(
		Layer.mergeAll(
			layerRpc({group: RpcContracts, handlers: Layer.mergeAll(inventoryHandlers, metricsHandlers, exposuresHandlers)}),
			layerMcp({
				contracts: toolkit,
				instructions:
					'Use list_apps for the machine’s inventory and read_resource_history for resource comparisons. create_exposure and remove_exposure manage owned HTTPS mappings; run_job starts scheduled jobs.',
				registrations: Layer.provide(
					McpServer.toolkit(toolkit),
					Layer.mergeAll(inventoryToolHandlers, metricsToolHandlers, exposuresToolHandlers)
				)
			})
		),
		layerServices
	)
})
