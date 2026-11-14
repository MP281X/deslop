import {Array, Boolean, Effect, Function, Layer, Option, Order, Stream, String, Struct, pipe} from 'effect'

import {McpSchema, McpServer} from 'effect/ai'

import {localAuth} from '@deslop/runtime/server/auth'
import {AuthError, DEVELOPER} from '@deslop/runtime/shared/auth'

import {Passkeys} from '#services/passkeys/service.ts'
import {People} from '#services/people/service.ts'
import {SignIns} from '#services/sign-ins/service.ts'
import {CurrentOwner, IncarnationId} from '#services/tokens/schema.ts'
import type {SignedInApp} from '#services/tokens/schema.ts'
import {Tokens} from '#services/tokens/service.ts'
import {ToolContracts} from '#tools/contracts.ts'

function page<A>(rows: readonly A[], key: (row: A) => string, input: {cursor: Option.Option<string>; limit: number}) {
	const remaining = pipe(
		rows,
		Array.sort(Order.mapInput(Order.String, key)),
		Array.filter(row => Option.match(input.cursor, {onNone: Function.constTrue, onSome: cursor => key(row) > cursor}))
	)
	const items = Array.take(remaining, input.limit)
	return {
		items,
		nextCursor: pipe(
			items,
			Array.last,
			Option.filter(() => remaining.length > input.limit),
			Option.map(key)
		)
	}
}

export const layerMcpOwner = Layer.unwrap(
	Effect.gen(function* () {
		const tokens = yield* Tokens
		const people = yield* People
		const local = yield* localAuth
		return McpServer.middleware<{provides: CurrentOwner}>()((effect, request) =>
			pipe(
				local,
				Boolean.match({
					onFalse: () => Effect.flatMap(tokens.verify(request.headers), people.allowed),
					onTrue: () => Effect.succeed({incarnation: IncarnationId.make('local'), user: DEVELOPER})
				}),
				// oxlint-disable-next-line @deslop/coding-standards/recover-named-failures -- MCP's wire error exposes no internal authorization cause.
				Effect.mapError((error: AuthError) =>
					McpSchema.McpErrorBase.make({
						code: Boolean.match(error.error === 'temporarily_unavailable', {
							onFalse: Function.constant(-32_001),
							onTrue: Function.constant(-32_603)
						}),
						message: error.message
					})
				),
				Effect.flatMap(owner => Effect.provideService(effect, CurrentOwner, owner))
			)
		).layer
	})
)

export const ToolHandlers = ToolContracts.toLayer(
	Effect.gen(function* () {
		const passkeys = yield* Passkeys
		const people = yield* People
		const signIns = yield* SignIns
		const tokens = yield* Tokens
		return ToolContracts.of({
			answer_sign_in: Effect.fnUntraced(function* (input) {
				return yield* signIns.answer(input, yield* CurrentOwner, 'Token')
			}),
			list_passkeys: Effect.fnUntraced(function* (input) {
				const found = page(
					Option.getOrElse(yield* Stream.runHead(passkeys.watch(yield* CurrentOwner)), () => []),
					passkey => passkey.id,
					input
				)
				return {...Struct.omit(found, ['items']), passkeys: found.items}
			}),
			list_people: Effect.fnUntraced(function* (input) {
				const found = page(yield* people.list((yield* CurrentOwner).user), person => person.name, input)
				return {
					...Struct.omit(found, ['items']),
					people: Array.map(found.items, person => ({login: person.name, role: person.role}))
				}
			}),
			list_sessions: Effect.fnUntraced(function* (input) {
				const found = page(
					Option.getOrElse(yield* Stream.runHead(tokens.watchApps(yield* CurrentOwner)), () => []),
					app => app.family,
					input
				)
				return {
					...Struct.omit(found, ['items']),
					sessions: Array.map(found.items, app => ({
						address: app.address,
						client: app.client,
						device: Option.liftPredicate(app.device, device => !Option.contains(app.address, device)),
						id: app.family,
						lastActive: app.lastActive
					}))
				}
			}),
			remove_passkey: Effect.fnUntraced(function* (input) {
				yield* passkeys.remove(input.id, yield* CurrentOwner)
				return {id: input.id}
			}),
			remove_person: Effect.fnUntraced(function* (input) {
				const owner = yield* CurrentOwner
				const wanted = String.toLowerCase(input.login)
				const person = yield* pipe(
					yield* people.list(owner.user),
					Array.findFirst(row => String.toLowerCase(row.name) === wanted),
					Effect.fromOption,
					Effect.mapError(() =>
						AuthError.make({
							message: `No GitHub account ${input.login} is listed in Auth; list_people shows valid logins. Nothing changed.`
						})
					)
				)
				return {login: (yield* people.remove(person.id, owner.user)).name}
			}),
			sign_out_session: Effect.fnUntraced(function* (input) {
				const owner = yield* CurrentOwner
				if (
					!pipe(
						yield* Stream.runHead(tokens.watchApps(owner)),
						Option.getOrElse(Array.empty<SignedInApp>),
						Array.some(session => session.family === input.id)
					)
				) {
					return yield* AuthError.make({
						message:
							'This sign-in has already ended or no session of yours has that id; list_sessions shows valid ids. Nothing changed.'
					})
				}
				yield* tokens.disconnect(input.id, owner)
				return {id: input.id}
			})
		})
	})
)
