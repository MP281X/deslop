import {Effect, Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'

import {runApp} from '@deslop/runtime/server/cli'
import {layerMcp, layerRpc} from '@deslop/runtime/server/http'
import {ToolPath} from '@deslop/runtime/server/process'
import {dataDirectory} from '@deslop/runtime/server/store'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Exposures} from '#services/exposures/service.ts'
import {Fleet, layerPeerAuth} from '#services/fleet/service.ts'
import {WorkerList} from '#services/inventory/schema.ts'
import {Inventory} from '#services/inventory/service.ts'
import {Metrics} from '#services/metrics/service.ts'
import {ToolContracts} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

const layerServices = pipe(
	Fleet.layer,
	Layer.provideMerge(
		Layer.mergeAll(Inventory.layer, Metrics.layer, Layer.unwrap(Effect.map(dataDirectory, Exposures.layer)))
	),
	Layer.provide(ToolPath.layer)
)

runApp({
	icon,
	routes: pipe(
		Layer.mergeAll(
			layerRpc({group: RpcContracts, handlers: RpcHandlers}),
			layerMcp({
				instructions:
					'Use list_apps for worker inventory and read_resource_history for resource comparisons. create_exposure and remove_exposure manage owned HTTPS mappings; run_job starts scheduled jobs.',
				registrations: Layer.provide(McpServer.toolkit(ToolContracts), ToolHandlers)
			})
		),
		Layer.provide(layerServices),
		Layer.provide(layerPeerAuth)
	),
	settings: {
		DEPLOY_WORKERS: {
			description: "The other workers' Deploy origins as name=origin, comma-separated",
			flag: 'workers',
			schema: WorkerList
		}
	}
})
