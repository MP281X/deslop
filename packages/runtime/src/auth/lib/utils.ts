import {Array, Config, Context, Effect, Option, Predicate, Schema, String} from 'effect'

import {Headers, HttpClient} from 'effect/http'
import {RpcMiddleware} from 'effect/rpc'

import type {User} from '#auth/schema.ts'
import {AuthError} from '#auth/schema.ts'

// Native apps and MCP clients sign in here; backends verify their bearer here.
export const AUTH_URL = 'https://auth.mp281x.xyz'

// Auth serves and advertises its OAuth endpoints under this path, which its clients call.
export const ISSUER_PATH = '/api/auth'
export const ISSUER = `${AUTH_URL}${ISSUER_PATH}`

// An app's server asks Auth about a bearer at `VERIFY_PATH` and about its session cookie at `SESSION_PATH`; at start it announces itself at `APPS_PATH`.
export const APPS_PATH = '/api/apps'
export const SESSION_PATH = '/auth/session'
export const VERIFY_PATH = '/auth/verify'

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
		if (Predicate.isTagged(cause, 'KeyValueStoreError') || HttpClient.isTransientError(cause)) {
			return AuthError.make({cause, error: 'temporarily_unavailable', message})
		}
		return AuthError.make({cause, message})
	})
}

// An outage keeps credentials and retries alive instead of looking like a permanent refusal.
export function failureOptions(error: unknown, status: number) {
	if (Schema.is(AuthError)(error) && error.error === 'temporarily_unavailable') {
		return {headers: {'retry-after': '5'}, status: 503}
	}
	return {status}
}

export class CurrentUser extends Context.Service<CurrentUser, User>()('@deslop/runtime/auth/lib/utils/CurrentUser') {}

// Contracts add it with `.middleware(RpcAuth)`; the server's `Auth.layer` verifies each request.
export class RpcAuth extends RpcMiddleware.Service<RpcAuth, {provides: CurrentUser}>()(
	'@deslop/runtime/auth/lib/utils/RpcAuth',
	{error: AuthError}
) {}

// Sends the session token as the bearer of every request, read again for each one.
export function layerRpcAuthClient<R>(token: Effect.Effect<string, AuthError, R>) {
	return RpcMiddleware.layerClient(RpcAuth, options =>
		Effect.gen(function* () {
			return yield* options.next({
				...options.request,
				headers: Headers.set(options.request.headers, 'authorization', `Bearer ${yield* token}`)
			})
		})
	)
}
