import {Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {RpcServer} from 'effect/rpc'

import * as CliRuntime from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

CliRuntime.runApp({
	icon,
	routes: Layer.mergeAll(
		pipe(
			RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
			Layer.provide(RpcHandlers)
		),
		ServerRuntime.layerMcp({
			instructions: "Read the app's name with name.",
			registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers))
		})
	)
})
