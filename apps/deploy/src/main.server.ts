import {Effect, Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {RpcServer} from 'effect/rpc'

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
				Layer.mergeAll(Inventory.layer, Exposures.layer(directory), Metrics.layer(directory))
			)
		)
	)
)

CliRuntime.runApp({
	icon,
	routes: pipe(
		Layer.mergeAll(
			pipe(
				RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
				Layer.provide(RpcHandlers)
			),
			ServerRuntime.layerMcp({
				instructions: 'Deploy observes services, containers and ports and manages explicitly owned HTTPS exposure.',
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
