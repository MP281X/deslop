import {Layer} from 'effect'

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
		ServerRuntime.layerRpc({group: RpcContracts, handlers: RpcHandlers}),
		ServerRuntime.layerMcp({handlers: ToolHandlers, instructions: "Read the app's name with name.", tools: Tools})
	)
})
