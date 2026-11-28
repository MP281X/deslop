import {Effect, Layer, pipe} from 'effect'

import {McpServer, Toolkit} from 'effect/ai'

import {runApp} from '@deslop/runtime/server/cli'
import {layerMcp, layerRpc} from '@deslop/runtime/server/http'
import {ToolPath} from '@deslop/runtime/server/process'
import {dataDirectory} from '@deslop/runtime/server/store'

import {exposuresHandlers, exposuresToolHandlers, exposuresTools} from '#exposures/handlers.ts'
import {Exposures} from '#exposures/server.ts'
import {inventoryHandlers, inventoryToolHandlers, inventoryTools} from '#inventory/handlers.ts'
import {Inventory} from '#inventory/server.ts'
import {RpcContracts} from '#machine/contract.ts'
import {Machine} from '#machine/server.ts'
import {metricsHandlers, metricsToolHandlers, metricsTools} from '#metrics/handlers.ts'
import {Metrics} from '#metrics/server.ts'
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
