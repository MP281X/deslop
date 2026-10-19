import {NodeRuntime} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {HttpRouter} from 'effect/http'
import {RpcServer} from 'effect/rpc'

import * as ServerRuntime from '@deslop/runtime/server'

import packageJson from '#package.json' with {type: 'json'}

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Presence} from '#services/presence/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

const mcp = pipe(
	McpServer.toolkit(Tools),
	Layer.provide(ToolHandlers),
	Layer.provide(
		ServerRuntime.layerMcp({
			instructions: "The portfolio shows each visitor's cursor live to everyone on the page. List them with visitors.",
			name: 'portfolio',
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
		Layer.provide(Presence.layer),
		Layer.provide(ServerRuntime.layer('@deslop/portfolio')),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
