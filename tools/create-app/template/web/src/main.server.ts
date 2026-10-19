import {NodeRuntime} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {HttpRouter} from 'effect/http'
import {RpcServer} from 'effect/rpc'

import * as ServerRuntime from '@deslop/runtime/server'

import packageJson from '#package.json' with {type: 'json'}

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

const mcp = pipe(
	McpServer.toolkit(Tools),
	Layer.provide(ToolHandlers),
	Layer.provide(
		ServerRuntime.layerMcp({
			instructions: "Read the app's name with name.",
			name: 'template-app',
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
		Layer.provide(ServerRuntime.layer('@deslop/template-app')),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
