import {Effect} from 'effect'

import {CurrentUser} from '@deslop/runtime/auth/utils'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Authorizations} from '#services/authorizations/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const authorizations = yield* Authorizations
		return RpcContracts.of({
			'auth.me': () => CurrentUser,
			'auth.pending': (_, options) => authorizations.pending(options.headers),
			'auth.wait': (input, options) => authorizations.wait(input.request, options.headers)
		})
	})
)
