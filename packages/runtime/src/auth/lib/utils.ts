import {Array, Config, Context, Effect, Option, Schema, String} from 'effect'

import {Headers} from 'effect/http'
import {RpcMiddleware} from 'effect/rpc'

import type {User} from '#auth/schema.ts'
import {AuthError} from '#auth/schema.ts'

// Native apps and MCP clients sign in here; backends verify their bearer here.
export const AUTH_URL = 'https://auth.mp281x.xyz'

export const DEVELOPER = {id: 'github:0', name: 'dev'} satisfies User

// Without an issuer (`--auth`) there is no sign-in: every request is this trusted developer, and Auth's GitHub step signs it in at once.
export const localAuth = Config.map(Config.option(Config.String('AUTH_URL')), Option.isNone)

// Admins come from GITHUB_ADMINS; a local install with no issuer falls back to the developer account when none are named.
export const adminIds = Effect.gen(function* () {
	const listed = Config.Array(Schema.String, 'GITHUB_ADMINS')
	if (yield* localAuth) return yield* Config.withDefault(listed, ['0'])
	return yield* listed
})

// GITHUB_ADMINS lists bare GitHub ids; a user's id carries its provider as a prefix.
export function isAdmin(admins: readonly string[], id: string) {
	return Array.contains(admins, String.replace('github:', '')(id))
}

// Auth offers GitHub or a code another device approves, then returns to `next` on any mp281x.xyz app.
export function signInUrl(next: string) {
	return `${new URL(next).origin}/auth/sign-in?${new URLSearchParams({next})}`
}

export function needsSignIn(error: unknown) {
	return Schema.is(AuthError)(error) && error.error !== 'temporarily_unavailable' && error.error !== 'access_denied'
}

// A failure that already carries its answer stays as it is; anything else becomes the message the caller names.
export function rejected(message: string) {
	return Effect.mapError(cause => {
		if (Schema.is(AuthError)(cause)) return cause
		return AuthError.make({cause, message})
	})
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
