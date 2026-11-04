import {Layer, Schema, pipe} from 'effect'

import * as CliRuntime from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Core} from '#services/core/service.ts'
import {Game} from '#services/game/service.ts'

type Count = typeof Count.Type
const Count = Schema.String.check(Schema.isPattern(/^\d+$/u))

CliRuntime.runApp({
	icon,
	routes: pipe(
		ServerRuntime.layerRpc({group: RpcContracts, handlers: RpcHandlers}),
		Layer.provide(Game.layer),
		Layer.provide(Core.layer),
		Layer.provide(ServerRuntime.layerDataStore)
	),
	settings: {
		SIGNAL_CONTEXT_TOKENS: {
			description: "Tokens of a team model's decision context, 8000 to 64000; defaults to 16000",
			flag: 'context-tokens',
			schema: Count
		},
		SIGNAL_LOCAL_DECISIONS_PER_SECOND: {
			description: 'Local decisions per second, 0 to 4; defaults to 2',
			flag: 'local-decisions',
			schema: Count
		},
		SIGNAL_RUN: {
			description: 'Whether the world starts running or paused; defaults to paused',
			flag: 'run',
			schema: Schema.Literals(['running', 'paused'])
		}
	}
})
