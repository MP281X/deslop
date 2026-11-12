import {NodeDns} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {RpcSerialization} from 'effect/rpc'

import {HttpAuth} from '@deslop/runtime/server/auth'
import * as CliRuntime from '@deslop/runtime/server/cli'
import * as ServerRuntime from '@deslop/runtime/server/http'
import {ToolPath} from '@deslop/runtime/server/process'

import {HttpHandlers} from '#http/handlers.ts'
import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Media} from '#services/media/service.ts'
import {layerNotes} from '#services/notes/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

// Binary frames failed to reopen a cancelled watch.
const rpc = pipe(
	ServerRuntime.layerRpc({group: RpcContracts, handlers: RpcHandlers}),
	Layer.provide(RpcSerialization.layerJson)
)

CliRuntime.runApp({
	icon,
	routes: pipe(
		Layer.mergeAll(
			rpc,
			pipe(HttpHandlers, Layer.provide(HttpAuth.layer)),
			ServerRuntime.layerMcp({
				instructions:
					'Stash holds the reading list of articles, videos and posts the user saved or asks to keep; start with search_notes.',
				registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers))
			})
		),
		Layer.provide(layerNotes),
		Layer.provide(Media.layer),
		Layer.provide(ToolPath.layer),
		Layer.provide(NodeDns.layer)
	)
})
