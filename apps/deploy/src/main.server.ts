import {Effect, Layer, pipe} from 'effect'

import * as CliRuntime from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Exposures} from '#services/exposures/service.ts'
import {Fleet, layerPeerAuth} from '#services/fleet/service.ts'
import {WorkerList} from '#services/inventory/schema.ts'
import {Inventory} from '#services/inventory/service.ts'
import {Metrics} from '#services/metrics/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

const layerServices = pipe(
	Fleet.layer,
	Layer.provideMerge(
		Layer.unwrap(
			Effect.map(ServerRuntime.dataDirectory, directory =>
				Layer.provide(
					Layer.mergeAll(Inventory.layer, Exposures.layer(directory), Metrics.layer),
					ServerRuntime.layerKeyValueStore(directory)
				)
			)
		)
	),
	Layer.provide(ServerRuntime.ToolPath.layer)
)

CliRuntime.runApp({
	icon,
	routes: pipe(
		Layer.mergeAll(
			ServerRuntime.layerRpc({group: RpcContracts, handlers: RpcHandlers}),
			ServerRuntime.layerMcp({
				handlers: ToolHandlers,
				instructions: 'Deploy observes services, containers and ports and manages explicitly owned HTTPS exposure.',
				tools: Tools
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
