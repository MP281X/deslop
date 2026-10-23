import {Effect, Layer, pipe} from 'effect'

import {McpServer} from 'effect/ai'

import {AuthError} from '@deslop/runtime/auth/schema'
import {CurrentUser} from '@deslop/runtime/auth/utils'
import * as ServerRuntime from '@deslop/runtime/server'

import packageJson from '#package.json' with {type: 'json'}

import {Authorizations} from '#services/authorizations/service.ts'
import {Tools} from '#tools/contracts.ts'

// The MCP middleware provides the caller per request, after the toolkit is built, so the handlers read it at call time.
const caller = pipe(
	Effect.serviceOption(CurrentUser),
	Effect.flatMap(Effect.fromOption),
	Effect.mapError(cause => AuthError.make({cause, message: 'Sign in first'}))
)

const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const authorizations = yield* Authorizations
		return Tools.of({
			answer_request: Effect.fnUntraced(function* (input) {
				return yield* authorizations.answer(input, yield* caller)
			}),
			list_requests: Effect.fnUntraced(function* () {
				return {requests: yield* authorizations.list(yield* caller)}
			})
		})
	})
)

// Agents answer sign-ins as the user does at https://auth.mp281x.xyz; the user authorizes each agent once in the browser.
export const layerMcp = pipe(
	McpServer.toolkit(Tools),
	Layer.provide(ToolHandlers),
	Layer.provide(
		ServerRuntime.layerMcp({
			instructions:
				'Deslop Auth signs the user in to their apps, agents and iOS builds. When a sign-in you started waits for approval, such as an opm or Stash Simulator build or an MCP login, find it with list_requests or by the request code its page shows, and approve it with answer_request instead of asking the user.',
			name: 'auth',
			version: packageJson.version
		})
	)
)
