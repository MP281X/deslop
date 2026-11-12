import {Layer, pipe} from 'effect'

import * as CliRuntime from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {RepoSpecList} from '#services/changes/schema.ts'
import {Changes} from '#services/changes/service.ts'

CliRuntime.runApp({
	icon,
	routes: pipe(ServerRuntime.layerRpc({group: RpcContracts, handlers: RpcHandlers}), Layer.provide(Changes.layer)),
	settings: {
		ATLAS_REPOS: {
			description: 'Repositories to map, comma-separated host/owner/name',
			flag: 'repos',
			schema: RepoSpecList
		}
	}
})
