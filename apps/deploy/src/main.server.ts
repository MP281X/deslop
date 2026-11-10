import {Effect, Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'

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
		Layer.mergeAll(
			Inventory.layer,
			Metrics.layer,
			Layer.unwrap(Effect.map(ServerRuntime.dataDirectory, Exposures.layer))
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
				instructions:
					'Start with list_apps to see what runs on the workers; Deploy also shows resource history, manages explicitly owned HTTPS exposure and starts scheduled jobs.',
				registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers))
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
