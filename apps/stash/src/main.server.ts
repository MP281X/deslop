import {NodeDns} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'

import {HttpAuth} from '@deslop/runtime/server/auth'
import {runApp} from '@deslop/runtime/server/cli'
import {layerMcp, layerRpc} from '@deslop/runtime/server/http'
import {ToolPath} from '@deslop/runtime/server/process'

import {HttpHandlers} from '#http/handlers.ts'
import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Media} from '#services/media/service.ts'
import {layerNotes} from '#services/notes/service.ts'
import {ToolContracts} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

runApp({
	icon,
	routes: pipe(
		Layer.mergeAll(
			layerRpc({group: RpcContracts, handlers: RpcHandlers}),
			Layer.provide(HttpHandlers, HttpAuth.layer),
			layerMcp({
				instructions:
					'Stash holds saved articles, videos and posts. Use search_notes when the id is unknown, or read_note directly with a known id; source sections are explicit.',
				registrations: Layer.provide(McpServer.toolkit(ToolContracts), ToolHandlers)
			})
		),
		Layer.provide(layerNotes),
		Layer.provide(Media.layer),
		Layer.provide(ToolPath.layer),
		Layer.provide(NodeDns.layer)
	)
})
