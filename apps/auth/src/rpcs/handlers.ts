import {Effect, Stream} from 'effect'

import {CurrentUser} from '@deslop/runtime/auth/utils'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Authorizations} from '#services/authorizations/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const authorizations = yield* Authorizations
		return RpcContracts.of({
			'auth.account': (_, options) => authorizations.account(options.headers),
			'auth.admit': Effect.fnUntraced(function* (input) {
				return yield* authorizations.admit(input, yield* CurrentUser)
			}),
			'auth.apps': () => Stream.unwrap(Effect.map(CurrentUser, authorizations.apps)),
			'auth.disconnect': Effect.fnUntraced(function* (input) {
				return yield* authorizations.disconnect(input.family, yield* CurrentUser)
			}),
			'auth.lookup': (input, options) => authorizations.lookup(input.code, options.headers),
			'auth.people': () => Stream.unwrap(Effect.map(CurrentUser, authorizations.people)),
			'auth.remove': Effect.fnUntraced(function* (input) {
				return yield* authorizations.remove(input.id, yield* CurrentUser)
			}),
			'auth.wait': (input, options) => authorizations.wait(input.request, options.headers)
		})
	})
)
