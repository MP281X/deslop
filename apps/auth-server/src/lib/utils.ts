import {Effect, Schema, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import {AuthError} from '@deslop/auth/schema'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/auth-server/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer('@deslop/auth-server')
}) {}

// Signed out reads as none, so the page offers the sign-in.
export const meAtom = RpcClient.runtime.atom(
	pipe(
		Effect.flatMap(RpcClient, client => client('auth.me', undefined)),
		Effect.asSome,
		Effect.catchTag('AuthError', () => Effect.succeedNone)
	)
)

// An expired session reloads the account, which then offers the sign-in.
export const apiKeyAtom = RpcClient.runtime.fn(() =>
	pipe(
		Effect.flatMap(RpcClient, client => client('auth.createApiKey', undefined)),
		Effect.tapError(error => Effect.when(Atom.refresh(meAtom), Effect.succeed(Schema.is(AuthError)(error))))
	)
)
