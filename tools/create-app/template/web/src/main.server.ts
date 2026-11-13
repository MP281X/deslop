import {Layer} from 'effect'

import {McpServer} from 'effect/ai'

import {runApp} from '@deslop/runtime/server/cli'
import {layerMcp, layerRpc} from '@deslop/runtime/server/http'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

runApp({
	icon,
	routes: Layer.mergeAll(
		layerRpc({group: RpcContracts, handlers: RpcHandlers}),
		layerMcp({
			instructions: "Read the app's name with name.",
			registrations: Layer.provide(McpServer.toolkit(Tools), ToolHandlers)
		})
	)
})
