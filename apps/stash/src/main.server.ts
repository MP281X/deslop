import {NodeDns} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {RpcSerialization} from 'effect/rpc'

import {HttpAuth} from '@deslop/runtime/auth/service'
import * as CliRuntime from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import {HttpHandlers} from '#http/handlers.ts'
import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Media} from '#services/media/service.ts'
import {Sources} from '#services/notes/lib/extraction.ts'
import {Organizer} from '#services/notes/lib/organization.ts'
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
				instructions: 'Stash is the reading list of articles, videos and posts the user saved or asks to keep.',
				registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers))
			})
		),
		Layer.provide(layerNotes),
		Layer.provide(Layer.mergeAll(Sources.layer, Media.layer, Organizer.layer)),
		Layer.provide(ServerRuntime.ToolPath.layer),
		Layer.provide(NodeDns.layer)
	)
})
