import {NodeHttpClient} from '@effect/platform-node'

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
import {Presence} from '#services/presence/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

CliRuntime.runApp(
	packageJson,
	pipe(
		HttpRouter.serve(
			pipe(
				Layer.mergeAll(
					pipe(
						// Every visitor sends a move each 50 ms; a span per move would bury Scope.
						RpcServer.layerHttp({disableTracing: true, group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
						Layer.provide(RpcHandlers)
					),
					ServerRuntime.layerIcon(icon),
					ServerRuntime.layerMcp({
						instructions: 'Observe portfolio visitors without joining their room.',
						name: 'portfolio',
						registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers)),
						version: packageJson.version
					}),
					ServerRuntime.layerManifest('Portfolio'),
					ServerRuntime.layerStaticFiles
				),
				Layer.provide(Auth.layer('https://portfolio.mp281x.xyz'))
			),
			{disableLogger: true, middleware: ServerRuntime.localGuard}
		),
		Layer.provide(Presence.layer),
		Layer.provide(NodeHttpClient.layerFetch),
		Layer.provide(ServerRuntime.layer('@deslop/portfolio')),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
