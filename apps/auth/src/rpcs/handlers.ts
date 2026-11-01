import {Effect, Stream} from 'effect'

import {CurrentUser} from '@deslop/runtime/auth/utils'

import {RpcContracts} from '#rpcs/contracts.ts'
import {People} from '#services/people/service.ts'
import {SignIns} from '#services/sign-ins/service.ts'
import {Tokens} from '#services/tokens/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const people = yield* People
		const signIns = yield* SignIns
		const tokens = yield* Tokens
		return RpcContracts.of({
			'auth.account': (_, options) => people.account(options.headers),
			'auth.admit': Effect.fnUntraced(function* (input) {
				return yield* people.admit(input, yield* CurrentUser)
			}),
			// The page's RPC runs on the signed-in browser's session cookie.
			'auth.answer': Effect.fnUntraced(function* (input) {
				yield* signIns.answer(input, yield* CurrentUser, 'Session')
			}),
			'auth.apps': () => Stream.unwrap(Effect.map(CurrentUser, tokens.apps)),
			'auth.disconnect': Effect.fnUntraced(function* (input) {
				return yield* tokens.disconnect(input.family, yield* CurrentUser)
			}),
			'auth.lookup': input => signIns.lookup(input.code),
			'auth.people': () => Stream.unwrap(Effect.map(CurrentUser, people.people)),
			'auth.remove': Effect.fnUntraced(function* (input) {
				return yield* people.remove(input.id, yield* CurrentUser)
			}),
			'auth.resource.decide': Effect.fnUntraced(function* (input) {
				const user = yield* CurrentUser
				yield* people.admin(user)
				yield* tokens.resources.decide(input.id, input.approve, user.id)
			}),
			'auth.resources': () =>
				Stream.unwrap(
					Effect.gen(function* () {
						yield* people.admin(yield* CurrentUser)
						return tokens.resources.list
					})
				),
			'auth.wait': (input, options) => signIns.status(input.request, options.headers)
		})
	})
)
