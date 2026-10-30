import {NodeHttpClient, NodeRuntime} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {HttpRouter} from 'effect/http'
import {RpcSerialization, RpcServer} from 'effect/rpc'

import {Auth} from '@deslop/runtime/auth/service'
import * as ServerRuntime from '@deslop/runtime/server'

import packageJson from '#package.json' with {type: 'json'}

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

const mcp = ServerRuntime.layerMcp({
	instructions: "Read the app's name with name.",
	name: 'template-app',
	registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers)),
	version: packageJson.version
})

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(
			pipe(
				Layer.merge(
					pipe(
						RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
						Layer.provide(RpcHandlers),
						Layer.provide(RpcSerialization.layerJson)
					),
					mcp
				),
				Layer.provide(Auth.layer('https://template-app.mp281x.xyz'))
			),
			{disableLogger: true}
		),
		Layer.provide(ServerRuntime.layer('@deslop/template-app')),
		Layer.provide(NodeHttpClient.layerFetch),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
