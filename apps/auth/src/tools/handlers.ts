import {Array, Boolean, Effect, Layer, Option, Stream, String, Struct, pipe} from 'effect'

import {McpSchema, McpServer} from 'effect/ai'

import {AuthError} from '@deslop/runtime/auth/schema'
import {DEVELOPER, localAuth} from '@deslop/runtime/auth/utils'

import {People} from '#services/people/service.ts'
import {SignIns} from '#services/sign-ins/service.ts'
import {withChildActivity} from '#services/tokens/lib/utils.ts'
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
		const people = yield* People
		const signIns = yield* SignIns
		const tokens = yield* Tokens
		return Tools.of({
			answer_request: Effect.fnUntraced(function* (input) {
				return yield* signIns.answer(input, yield* CurrentOwner, 'Token')
			}),
			list_sessions: Effect.fnUntraced(function* () {
				return {
					sessions: Array.map(
						withChildActivity(Option.getOrElse(yield* Stream.runHead(tokens.apps(yield* CurrentOwner)), () => [])),
						app => ({...Struct.pick(app, ['address', 'client', 'device', 'lastActive']), id: app.family})
					)
				}
			}),
			remove_person: Effect.fnUntraced(function* (input) {
				const owner = yield* CurrentOwner
				const wanted = String.toLowerCase(input.login)
				const person = yield* pipe(
					yield* people.list(owner.user),
					Array.findFirst(row => String.toLowerCase(row.name) === wanted),
					Effect.fromOption,
					Effect.mapError(() => AuthError.make({message: `No GitHub account ${input.login} is listed in Auth`}))
				)
				return yield* people.remove(person.id, owner.user)
			}),
			sign_out_session: Effect.fnUntraced(function* (input) {
				yield* tokens.disconnect(input.id, yield* CurrentOwner)
				return {id: input.id}
			})
		})
	})
)
