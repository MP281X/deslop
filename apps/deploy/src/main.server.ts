import {NodeHttpClient, NodeServices} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {HttpRouter} from 'effect/http'
import {RpcServer} from 'effect/rpc'

import {Auth} from '@deslop/runtime/auth/service'
import * as CliRuntime from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import packageJson from '#package.json' with {type: 'json'}

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Exposures} from '#services/exposures/service.ts'
import {Fleet} from '#services/fleet/service.ts'
import {Inventory} from '#services/inventory/service.ts'
import {Metrics} from '#services/metrics/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

const mcp = ServerRuntime.layerMcp({
	instructions: 'Deploy observes services, containers and ports and manages explicitly owned HTTPS exposure.',
	name: 'deploy',
	registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers)),
	version: packageJson.version
})

CliRuntime.runApp(
	packageJson,
	pipe(
		HttpRouter.serve(
			pipe(
				Layer.mergeAll(
					pipe(
						RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
						Layer.provide(RpcHandlers)
					),
					mcp,
					ServerRuntime.layerIcon(icon),
					ServerRuntime.layerManifest('deploy'),
					ServerRuntime.layerStaticFiles
				),
				Layer.provide(Auth.layer('https://deploy.mp281x.xyz'))
			),
			{disableLogger: true, middleware: ServerRuntime.localGuard}
		),
		Layer.provide(
			pipe(Fleet.layer, Layer.provideMerge(Layer.mergeAll(Inventory.layer, Exposures.layer, Metrics.layer)))
		),
		Layer.provide(NodeServices.layer),
		Layer.provide(ServerRuntime.layer('@deslop/deploy')),
		Layer.provide(NodeHttpClient.layerFetch),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
