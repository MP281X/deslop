// fallow-ignore-file unused-type -- Schema types pair with their values so consumers can import either.
import {Array, Context, Effect, Option, Predicate, Schema, String, pipe} from 'effect'

import {Base64Url} from 'effect/encoding'
import {Headers, HttpClient} from 'effect/http'
import {RpcMiddleware} from 'effect/rpc'

export class AuthError extends Schema.TaggedError<AuthError>()('AuthError', {
	cause: Schema.optional(Schema.Defect()),
	error: Schema.optionalKey(
		Schema.Literals([
			'invalid_request',
			'invalid_client',
			'invalid_client_metadata',
			'invalid_redirect_uri',
			'invalid_grant',
			'invalid_scope',
			'unsupported_grant_type',
			'unsupported_response_type',
			'access_denied',
			'authorization_pending',
			'expired_token',
			'temporarily_unavailable'
		])
	),
	message: Schema.String
}) {
	// Scope reads a failure's exception type: an outage must not look like a refusal.
	override get name() {
		if (this.error === 'temporarily_unavailable') return 'AuthUnavailable'
		return 'AuthError'
	}
}

export type UserId = typeof UserId.Type
export const UserId = pipe(Schema.NonEmptyString, Schema.brand('UserId'))

export type User = typeof User.Type
export const User = Schema.Struct({id: UserId, name: Schema.NonEmptyString})

// Valid at every Deslop app for ten minutes.
export type AccessClaims = typeof AccessClaims.Type
export const AccessClaims = Schema.Struct({
	aud: Schema.Literal('deslop'),
	azp: Schema.NonEmptyString,
	exp: Schema.Int,
	iat: Schema.Int,
	iss: Schema.NonEmptyString,
	name: Schema.NonEmptyString,
	sid: Schema.NonEmptyString,
	sub: UserId
})

export type ClientRegistration = typeof ClientRegistration.Type
export const ClientRegistration = Schema.Struct({
	name: Schema.String,
	redirects: Schema.NonEmptyArray(Schema.NonEmptyString.check(Schema.isMaxLength(200))).check(Schema.isMaxLength(4))
})

export type CodeGrant = typeof CodeGrant.Type
export const CodeGrant = Schema.Struct({
	client_id: Schema.NonEmptyString,
	code: Schema.NonEmptyString,
	code_verifier: Schema.NonEmptyString,
	redirect_uri: Schema.NonEmptyString
})

export type SessionHandle = typeof SessionHandle.Type
export const SessionHandle = Schema.Struct({session: Schema.NonEmptyString})

export type TokenResponse = typeof TokenResponse.Type
export const TokenResponse = Schema.Struct({
	access_token: Schema.NonEmptyString,
	expires_in: Schema.Finite,
	refresh_token: Schema.NonEmptyString
})

export const AUTH_URL = 'https://auth.mp281x.xyz'

export const ISSUER_PATH = '/api/auth'
export const ISSUER = `${AUTH_URL}${ISSUER_PATH}`

export const APPS_PATH = '/api/apps'

export const COOKIE = {httpOnly: true, path: '/', sameSite: 'lax', secure: true} as const

export const SESSION_COOKIE = '__Host-session'

// RFC 9110 auth schemes are case-insensitive and may be followed by more than one space.
export function bearerOf(headers: Headers.Headers) {
	return Option.flatMapNullishOr(
		String.match(/^bearer +(?<token>\S+) *$/iu)(headers['authorization'] ?? ''),
		found => found.groups?.['token']
	)
}

// An access token Auth signed, as opposed to a phone's session id, which it also sends as the bearer.
export function isJwt(token: string) {
	return Option.isSome(String.match(/^[\w-]+\.[\w-]+\.[\w-]+$/u)(token))
}

export const AUTHORIZE_PATH = `${ISSUER_PATH}/oauth2/authorize`
export const TOKEN_PATH = `${ISSUER_PATH}/oauth2/token`
export const REVOKE_PATH = `${ISSUER_PATH}/oauth2/revoke`
export const DEVICE_PATH = `${ISSUER_PATH}/oauth2/device_authorization`
export const JWKS_PATH = '/.well-known/jwks.json'

export const CALLBACK_PATH = '/auth/callback'

// An access token lives ten minutes, so a removed account or signed-out session stops working everywhere within that time.
export const ACCESS_SECONDS = 600

// A refresh token lasts thirty days from its last use, so a session unused for longer cannot be renewed.
export const REFRESH_SECONDS = 30 * 86_400

// A client id is its registration, encoded: anyone may register, and Auth checks the callbacks again at authorize.
export function clientIdOf(client: ClientRegistration) {
	return Base64Url.encode(Schema.encodeSync(Schema.fromJsonString(ClientRegistration))(client))
}

export const DEVELOPER = {id: UserId.make('github:0'), name: 'dev'} satisfies User

// GITHUB_ADMINS lists bare GitHub ids; a user's id carries its provider as a prefix.
export function isAdmin(admins: readonly string[], id: string) {
	return Array.contains(admins, String.replace('github:', '')(id))
}

export function signInUrl(next: string) {
	return `${new URL(next).origin}/auth/sign-in?${new URLSearchParams({next})}`
}

export function needsSignIn(error: unknown) {
	return Schema.is(AuthError)(error) && error.error !== 'temporarily_unavailable' && error.error !== 'access_denied'
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

// An outage keeps credentials and retries alive instead of looking like a permanent refusal.
export function failureOptions(error: unknown, status: number) {
	if (Schema.is(AuthError)(error) && error.error === 'temporarily_unavailable') {
		return {headers: {'retry-after': '5'}, status: 503}
	}
	return {status}
}

export class CurrentUser extends Context.Service<CurrentUser, User>()('@deslop/runtime/shared/auth/CurrentUser') {}

export class RpcAuth extends RpcMiddleware.Service<RpcAuth, {provides: CurrentUser}>()(
	'@deslop/runtime/shared/auth/RpcAuth',
	{error: AuthError}
) {}

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
