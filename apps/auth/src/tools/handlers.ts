import {Array, Boolean, DateTime, Effect, Layer, Option, Stream, String, pipe} from 'effect'

import {McpSchema, McpServer} from 'effect/ai'

import {localAuth} from '@deslop/runtime/server/auth'
import {AuthError, DEVELOPER} from '@deslop/runtime/shared/auth'

import {Passkeys} from '#services/passkeys/service.ts'
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
		const passkeys = yield* Passkeys
		const people = yield* People
		const signIns = yield* SignIns
		const tokens = yield* Tokens
		return Tools.of({
			answer_request: Effect.fnUntraced(function* (input) {
				return yield* signIns.answer(input, yield* CurrentOwner, 'Token')
			}),
			list_passkeys: Effect.fnUntraced(function* () {
				return {passkeys: Option.getOrElse(yield* Stream.runHead(passkeys.list(yield* CurrentOwner)), () => [])}
			}),
			list_people: Effect.fnUntraced(function* () {
				return {
					people: Array.map(yield* people.list((yield* CurrentOwner).user), person => ({
						login: person.name,
						role: person.role
					}))
				}
			}),
			list_sessions: Effect.fnUntraced(function* () {
				return {
					sessions: Array.map(
						withChildActivity(Option.getOrElse(yield* Stream.runHead(tokens.apps(yield* CurrentOwner)), () => [])),
						app => ({
							...Option.match(Option.fromUndefinedOr(app.address), {
								onNone: () => ({}),
								onSome: address => ({address})
							}),
							client: app.client,
							...Boolean.match(app.device === app.address, {onFalse: () => ({device: app.device}), onTrue: () => ({})}),
							id: app.family,
							lastActive: DateTime.formatIso(DateTime.makeUnsafe(app.lastActive))
						})
					)
				}
			}),
			remove_passkey: Effect.fnUntraced(function* (input) {
				const owner = yield* CurrentOwner
				yield* pipe(
					Array.findFirst(
						Option.getOrElse(yield* Stream.runHead(passkeys.list(owner)), () => []),
						found => found.id === input.id
					),
					Effect.fromOption,
					Effect.mapError(() => AuthError.make({message: 'No passkey of yours has that id'}))
				)
				yield* passkeys.remove(input.id, owner)
				return {id: input.id}
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
				return {login: (yield* people.remove(person.id, owner.user)).name}
			}),
			sign_out_session: Effect.fnUntraced(function* (input) {
				yield* tokens.disconnect(input.id, yield* CurrentOwner)
				return {id: input.id}
			})
		})
	})
)
