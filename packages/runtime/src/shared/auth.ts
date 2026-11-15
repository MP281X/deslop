// fallow-ignore-file unused-type -- Schema types pair with their values so consumers can import either.
import {Context, Effect, Predicate, Schema, pipe} from 'effect'

import {HttpClient} from 'effect/http'
import {RpcMiddleware} from 'effect/rpc'

export class AuthError extends Schema.TaggedError<AuthError>()('AuthError', {
	cause: Schema.optional(Schema.Defect()),
	error: Schema.optionalKey(Schema.Literals(['access_denied', 'temporarily_unavailable'])),
	message: Schema.String
}) {
	// Scope reads a failure's exception type: an outage must not look like a refusal.
	override get name() {
		if (this.error === 'temporarily_unavailable') return 'AuthUnavailable'
		return 'AuthError'
	}
}

// `github:<id>` for a GitHub account, `tailnet:<login>` for a tailnet login from another identity provider.
export type UserId = typeof UserId.Type
export const UserId = pipe(Schema.NonEmptyString, Schema.brand('UserId'))

export type GitHubId = typeof GitHubId.Type
export const GitHubId = pipe(Schema.Int, Schema.brand('GitHubId'))

export type GitHubIdFromString = typeof GitHubIdFromString.Type
export const GitHubIdFromString = pipe(Schema.FiniteFromString, Schema.decodeTo(GitHubId))

export type User = typeof User.Type
export const User = Schema.Struct({admin: Schema.Boolean, id: UserId, name: Schema.NonEmptyString})

// The browser sign-in every `*.<domain>` app reads; tailnet callers need none.
export const SESSION_COOKIE = '__Secure-deslop-session'

// The client address the runtime derived from its proxy, replacing any value a caller sent.
export const CLIENT_HEADER = 'x-deslop-client'

// A Deslop app on Auth's machine acting for a person, as Gateway does for an agent and an app does for its AI calls.
export const ON_BEHALF_HEADER = 'x-deslop-user'

export const IDENTIFY_PATH = '/api/identify'

// What an app forwards for Auth to name the caller.
export type IdentifyRequest = typeof IdentifyRequest.Type
export const IdentifyRequest = Schema.Struct({
	address: Schema.OptionFromOptionalKey(Schema.NonEmptyString),
	onBehalfOf: Schema.OptionFromOptionalKey(UserId),
	session: Schema.OptionFromOptionalKey(Schema.NonEmptyString)
})

export const DEVELOPER = {admin: true, id: UserId.make('github:0'), name: 'dev'} satisfies User

// The app's own route, which hands the browser to Auth and back.
export function signInUrl(next: string) {
	return `${new URL(next).origin}/auth/sign-in?${new URLSearchParams({next})}`
}

export function needsSignIn(error: unknown) {
	return Schema.is(AuthError)(error) && error.error === undefined
}

export function isDenied(error: unknown) {
	return Schema.is(AuthError)(error) && error.error !== 'temporarily_unavailable'
}

export function asAuthError(message: string) {
	return Effect.mapError(cause => {
		if (Schema.is(AuthError)(cause)) return cause
		if (Predicate.isTagged(cause, 'SqlError') || HttpClient.isTransientError(cause)) {
			return AuthError.make({cause, error: 'temporarily_unavailable', message})
		}
		return AuthError.make({cause, message})
	})
}

// An outage keeps clients retrying instead of looking like a permanent refusal.
export function failureOptions(error: unknown, status: number) {
	if (Schema.is(AuthError)(error) && error.error === 'temporarily_unavailable') {
		return {headers: {'retry-after': '5'}, status: 503}
	}
	if (Schema.is(AuthError)(error) && error.error === 'access_denied') return {status: 403}
	return {status}
}

export class CurrentUser extends Context.Service<CurrentUser, User>()('@deslop/runtime/shared/auth/CurrentUser') {}

export class RpcAuth extends RpcMiddleware.Service<RpcAuth, {provides: CurrentUser}>()(
	'@deslop/runtime/shared/auth/RpcAuth',
	{error: AuthError}
) {}
