import {NodeHttpClient, NodeServices} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {HttpRouter} from 'effect/http'
import {RpcSerialization, RpcServer} from 'effect/rpc'

import {Auth} from '@deslop/runtime/auth/service'
import {runApp} from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import packageJson from '#package.json' with {type: 'json'}

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {layerChapters} from '#services/chapters/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

runApp(
	'opm',
	pipe(
		HttpRouter.serve(
			pipe(
				Layer.mergeAll(
					pipe(
						RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
						Layer.provide(RpcHandlers),
						Layer.provide(RpcSerialization.layerJson)
					),
					ServerRuntime.layerMcp({
						instructions: 'Read the One Punch Man library and update reading progress.',
						name: 'opm',
						registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers)),
						version: packageJson.version
					}),
					ServerRuntime.layerIcon(icon)
				),
				Layer.provide(Auth.layer('https://opm.mp281x.xyz'))
			),
			{disableLogger: true, middleware: ServerRuntime.localGuard}
		),
		Layer.provide(layerChapters),
		Layer.provide(Layer.mergeAll(NodeHttpClient.layerFetch, NodeServices.layer)),
		Layer.provide(ServerRuntime.layer('@deslop/opm')),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
