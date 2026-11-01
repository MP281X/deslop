import {Config, Context, Effect, pipe} from 'effect'

import {Headers} from 'effect/http'
import {RpcMiddleware} from 'effect/rpc'

import type {User} from '#auth/schema.ts'
import {AuthError} from '#auth/schema.ts'

// Native apps and MCP clients sign in here; backends verify their bearer here.
export const AUTH_URL = 'https://auth.mp281x.xyz'

// Previews run with NODE_ENV=development: no sign-in, everyone is this user, and Auth's GitHub step signs it in at once.
export const development = pipe(
	Config.String('NODE_ENV'),
	Config.withDefault('production'),
	Config.map(mode => mode === 'development')
)
export const DEVELOPER = {id: 'github:0', name: 'dev'} satisfies User

// Auth offers GitHub or a code another device approves, then returns to `next` on any mp281x.xyz app.
export function signInUrl(next: string) {
	return `${new URL(next).origin}/auth/sign-in?${new URLSearchParams({next})}`
}

export class CurrentUser extends Context.Service<CurrentUser, User>()('@deslop/runtime/auth/lib/utils/CurrentUser') {}

// Contracts add it with `.middleware(RpcAuth)`; the server's `Auth.layer` verifies each request.
export class RpcAuth extends RpcMiddleware.Service<RpcAuth, {provides: CurrentUser}>()(
	'@deslop/runtime/auth/lib/utils/RpcAuth',
	{error: AuthError}
) {
	// Sends the session token as the bearer of every request, read again for each one.
	static readonly layerClient = <R>(token: Effect.Effect<string, AuthError, R>) =>
		RpcMiddleware.layerClient(RpcAuth, options =>
			Effect.gen(function* () {
				return yield* options.next({
					...options.request,
					headers: Headers.set(options.request.headers, 'authorization', `Bearer ${yield* token}`)
				})
			})
		)
}
