import {NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {HttpRouter} from 'effect/http'
import {RpcServer} from 'effect/rpc'

import {Auth} from '@deslop/runtime/auth/service'
import * as ServerRuntime from '@deslop/runtime/server'

import packageJson from '#package.json' with {type: 'json'}

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Core} from '#services/core/service.ts'
import {Game} from '#services/game/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

const mcp = pipe(
	McpServer.toolkit(Tools),
	Layer.provide(ToolHandlers),
	Layer.provide(
		ServerRuntime.layerMcp({
			instructions: "Read the app's name with name.",
			name: 'signal',
			version: packageJson.version
		})
	)
)

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(
			Layer.mergeAll(
				pipe(
					RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
					Layer.provide(RpcHandlers)
				),
				mcp,
				ServerRuntime.layerStaticFiles
			),
			{disableLogger: true}
		),
		Layer.provide(ServerRuntime.layer('@deslop/signal')),
		Layer.provide(Auth.layer('https://signal.mp281x.xyz')),
		Layer.provide(Game.layer),
		Layer.provide(Core.layer),
		Layer.provide(Layer.mergeAll(NodeHttpClient.layerFetch, NodeServices.layer)),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
