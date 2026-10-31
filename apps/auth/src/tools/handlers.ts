import {Effect, Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'

import {CurrentUser} from '@deslop/runtime/auth/utils'
import * as ServerRuntime from '@deslop/runtime/server'

import packageJson from '#package.json' with {type: 'json'}

import icon from '#routes/icon.png'
import {SignIns} from '#services/sign-ins/service.ts'
import {Tools} from '#tools/contracts.ts'

const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const signIns = yield* SignIns
		return Tools.of({
			answer_request: Effect.fnUntraced(function* (input) {
				return yield* signIns.answer(input, yield* CurrentUser, 'Token')
			})
		})
	})
)

export const layerMcp = ServerRuntime.layerMcp({
	icon,
	instructions: 'Approve a sign-in you started with answer_request.',
	name: 'auth',
	registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers)),
	version: packageJson.version
})
