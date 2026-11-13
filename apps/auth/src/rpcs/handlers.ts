import {Effect, Option, Stream} from 'effect'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Passkeys} from '#services/passkeys/service.ts'
import {People} from '#services/people/service.ts'
import {SignIns} from '#services/sign-ins/service.ts'
import {originFrom} from '#services/tokens/lib/utils.ts'
import {CurrentOwner} from '#services/tokens/schema.ts'
import {Tokens} from '#services/tokens/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const passkeys = yield* Passkeys
		const people = yield* People
		const signIns = yield* SignIns
		const tokens = yield* Tokens
		return RpcContracts.of({
			'passkeys.add': Effect.fnUntraced(function* (input, options) {
				yield* passkeys.add(input.response, {
					from: originFrom(options.headers, Option.none()),
					owner: yield* CurrentOwner,
					via: yield* tokens.sessionVia(options.headers)
				})
			}),
			'passkeys.registration': Effect.fnUntraced(function* (_, options) {
				return yield* passkeys.registration(yield* CurrentOwner, yield* tokens.sessionVia(options.headers))
			}),
			'passkeys.watch': () => Stream.unwrap(Effect.map(CurrentOwner, passkeys.watch)),
			'people.account': (_, options) => people.account(options.headers),
			'people.admit': Effect.fnUntraced(function* (input) {
				return yield* people.admit(input, yield* CurrentUser)
			}),
			'people.watch': () => Stream.unwrap(Effect.map(CurrentUser, people.watch)),
			// The page's RPC runs on the signed-in browser's session cookie.
			'sign-ins.answer': Effect.fnUntraced(function* (input) {
				yield* signIns.answer(input, yield* CurrentOwner, 'Session')
			}),
			'sign-ins.lookup': input => signIns.lookup(input.code),
			'sign-ins.status': (input, options) => signIns.status(input.request, options.headers),
			'tokens.watchApps': () => Stream.unwrap(Effect.map(CurrentOwner, tokens.watchApps))
		})
	})
)
