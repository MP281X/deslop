import {Boolean, Effect, Layer} from 'effect'

import {McpSchema, McpServer} from 'effect/ai'

import {DEVELOPER, localAuth} from '@deslop/runtime/auth/utils'

import {People} from '#services/people/service.ts'
import {SignIns} from '#services/sign-ins/service.ts'
import {CurrentOwner} from '#services/tokens/schema.ts'
import {Tokens} from '#services/tokens/service.ts'
import {Tools} from '#tools/contracts.ts'

export const layerMcpOwner = Layer.unwrap(
	Effect.gen(function* () {
		const tokens = yield* Tokens
		const people = yield* People
		const local = yield* localAuth
		return McpServer.middleware<{provides: CurrentOwner}>()((effect, request) =>
			Effect.flatMap(
				Effect.mapError(
					Boolean.match(local, {
						onFalse: () => Effect.flatMap(tokens.verify(request.headers), people.allowed),
						onTrue: () => Effect.succeed({incarnation: 'local', user: DEVELOPER})
					}),
					// oxlint-disable-next-line @deslop/coding-standards/preserve-error-cause -- MCP's wire error exposes no internal authorization cause.
					error =>
						McpSchema.McpErrorBase.make({
							code: Boolean.match(error.error === 'temporarily_unavailable', {
								onFalse: () => -32_001,
								onTrue: () => -32_603
							}),
							message: error.message
						})
				),
				owner => Effect.provideService(effect, CurrentOwner, owner)
			)
		).layer
	})
)

export const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const signIns = yield* SignIns
		return Tools.of({
			answer_request: Effect.fnUntraced(function* (input) {
				return yield* signIns.answer(input, yield* CurrentOwner, 'Token')
			})
		})
	})
)
