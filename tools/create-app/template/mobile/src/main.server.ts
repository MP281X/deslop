import {Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {RpcSerialization} from 'effect/rpc'

import * as CliRuntime from '@deslop/runtime/server/cli'
import * as ServerRuntime from '@deslop/runtime/server/http'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

CliRuntime.runApp({
	icon,
	routes: Layer.mergeAll(
		pipe(
			ServerRuntime.layerRpc({group: RpcContracts, handlers: RpcHandlers}),
			Layer.provide(RpcSerialization.layerJson)
		),
		ServerRuntime.layerMcp({
			instructions: "Read the app's name with name.",
			registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers))
		})
	)
})
