import {Array, Context, Effect, Number, Option, Result, pipe} from 'effect'

import {Headers, Url} from 'effect/http'
import {RpcMiddleware} from 'effect/rpc'

import type {User} from '#auth/schema.ts'
import {AuthError} from '#auth/schema.ts'

// Native apps and MCP clients sign in here; backends verify their bearer here.
export const AUTH_URL = 'https://auth.mp281x.xyz'

// The worktree preview script assigns HTTPS ports 20000–29999 on these two workers.
export function previewOrigin(address: string) {
	return pipe(
		Result.getSuccess(Url.fromString(address)),
		Option.filter(
			target =>
				target.protocol === 'https:' &&
				Array.contains(['dev.tailnet-8c4c.ts.net', 'desktop.tailnet-8c4c.ts.net'], target.hostname) &&
				target.username === '' &&
				target.password === '' &&
				Option.exists(Number.parse(target.port), port => port >= 20_000 && port < 30_000)
		),
		Option.map(target => target.origin)
	)
}

export function signInUrl(next: string) {
	return `/auth/sign-in?${new URLSearchParams({next})}`
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
