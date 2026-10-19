import {Effect} from 'effect'

import {Authorizations} from '@deslop/auth/service'
import {CurrentUser} from '@deslop/auth/utils'

import {RpcContracts} from '#rpcs/contracts.ts'

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
