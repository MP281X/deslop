import {Effect, Option, Stream} from 'effect'

import {CurrentUser} from '@deslop/runtime/auth/utils'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Apps} from '#services/apps/service.ts'
import {Passkeys} from '#services/passkeys/service.ts'
import {People} from '#services/people/service.ts'
import {SignIns} from '#services/sign-ins/service.ts'
import {originFrom} from '#services/tokens/lib/utils.ts'
import {Tokens} from '#services/tokens/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const apps = yield* Apps
		const passkeys = yield* Passkeys
		const people = yield* People
		const signIns = yield* SignIns
		const tokens = yield* Tokens
		return RpcContracts.of({
			'auth.account': (_, options) => people.account(options.headers),
			// Named after the browser and device it was added from, as the sign-ins grid names them.
			'auth.addPasskey': Effect.fnUntraced(function* (input, options) {
				yield* passkeys.add(input.response, {
					from: originFrom(options.headers, Option.none()),
					user: yield* CurrentUser,
					via: yield* tokens.sessionVia(options.headers)
				})
			}),
			'auth.admit': Effect.fnUntraced(function* (input) {
				return yield* people.admit(input, yield* CurrentUser)
			}),
			// The page's RPC runs on the signed-in browser's session cookie.
			'auth.answer': Effect.fnUntraced(function* (input) {
				yield* signIns.answer(input, yield* CurrentUser, 'Session')
			}),
			'auth.apps': () => Stream.unwrap(Effect.map(CurrentUser, tokens.apps)),
			'auth.catalog': () => apps.catalog,
			'auth.createAgent': Effect.fnUntraced(function* (input) {
				return yield* tokens.createAgent(yield* CurrentUser, input)
			}),
			'auth.disconnect': Effect.fnUntraced(function* (input) {
				return yield* tokens.disconnect(input.family, yield* CurrentUser)
			}),
			'auth.lookup': input => signIns.lookup(input.code),
			'auth.passkeyOptions': Effect.fnUntraced(function* (_, options) {
				return yield* passkeys.registration(yield* CurrentUser, yield* tokens.sessionVia(options.headers))
			}),
			'auth.passkeys': () => Stream.unwrap(Effect.map(CurrentUser, passkeys.list)),
			'auth.people': () => Stream.unwrap(Effect.map(CurrentUser, people.people)),
			'auth.remove': Effect.fnUntraced(function* (input) {
				return yield* people.remove(input.id, yield* CurrentUser)
			}),
			'auth.removePasskey': Effect.fnUntraced(function* (input) {
				yield* passkeys.remove(input.id, yield* CurrentUser)
			}),
			'auth.wait': (input, options) => signIns.status(input.request, options.headers)
		})
	})
)
