import {Effect, pipe} from 'effect'

import {oauthProviderClient} from '@better-auth/oauth-provider/client'
import {createAuthClient} from 'better-auth/client'
import {Atom, AtomRpc} from 'effect/reactivity'

import {AuthError} from '@deslop/auth/schema'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'

const client = createAuthClient({baseURL: location.origin, plugins: [oauthProviderClient()]})

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/auth-server/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer('@deslop/auth-server')
}) {}

export const meAtom = RpcClient.runtime.atom(
	pipe(
		Effect.flatMap(RpcClient, rpc => rpc('auth.me', undefined)),
		Effect.asSome,
		Effect.catchTag('AuthError', () => Effect.succeedNone)
	)
)

export const signInAtom = Atom.fn(() =>
	Effect.tryPromise({
		catch: cause => AuthError.make({cause, message: 'Cannot start GitHub sign-in'}),
		try: () => client.signIn.social({callbackURL: location.href, provider: 'github'}, {throw: true})
	})
)

export const signOutAtom = Atom.fn(() =>
	pipe(
		Effect.tryPromise({
			catch: cause => AuthError.make({cause, message: 'Cannot sign out'}),
			try: () => client.signOut({fetchOptions: {throw: true}})
		}),
		Effect.andThen(Effect.sync(() => location.assign('/')))
	)
)

export const consentAtom = Atom.fn((accept: boolean) =>
	pipe(
		Effect.tryPromise({
			catch: cause => AuthError.make({cause, message: 'Cannot finish authorization'}),
			try: () => client.oauth2.consent({accept}, {throw: true})
		}),
		Effect.flatMap(result => Effect.sync(() => location.assign(result.url)))
	)
)
