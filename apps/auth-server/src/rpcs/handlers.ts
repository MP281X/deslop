import {Effect} from 'effect'

import {Issuer} from '@deslop/auth/service'
import {CurrentUser} from '@deslop/auth/utils'

import {RpcContracts} from '#rpcs/contracts.ts'

// An API key is a session token for a command line, shown once and kept by it.
export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const issuer = yield* Issuer
		return RpcContracts.of({
			'auth.createApiKey': () => Effect.flatMap(CurrentUser, user => issuer.issue(user)),
			'auth.me': () => CurrentUser
		})
	})
)
