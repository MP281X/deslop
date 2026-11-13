import {Config, Context, Effect, Layer, Option, Result, Schema, pipe} from 'effect'

import {Signature} from 'effect/crypto'
import type {Headers} from 'effect/http'
import {FetchHttpClient, HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'
import {JoseError, Jwks, Jwt} from 'effect/jose'

import {Sessions, sessionIdOf} from '#server/sessions.ts'
import {
	AccessClaims,
	AuthError,
	CurrentUser,
	DEVELOPER,
	ISSUER_PATH,
	JWKS_PATH,
	RpcAuth,
	bearerOf,
	isAdmin,
	isJwt
} from '#shared/auth.ts'
import type {User} from '#shared/auth.ts'
import {MCP_METADATA_PATH} from '#shared/schema.ts'

// Without an issuer (`--auth`) there is no sign-in: every request is this trusted developer, and Auth's GitHub step signs it in at once.
export const localAuth = Config.map(Config.option(Config.String('AUTH_URL')), Option.isNone)

// Admins come from GITHUB_ADMINS; a local install with no issuer falls back to the developer account when none are named.
export const adminIds = Effect.gen(function* () {
	const listed = Config.Array(Schema.String, 'GITHUB_ADMINS')
	if (yield* localAuth) return yield* Config.withDefault(listed, ['0'])
	return yield* listed
})

export function requireAdmin(admins: readonly string[], user: User, message: string) {
	if (isAdmin(admins, user.id)) return Effect.void
	return Effect.fail(AuthError.make({error: 'access_denied', message}))
}

const signInFirst = AuthError.make({message: 'Sign in first'})

const unavailable = HttpServerResponse.text('The authorization service is temporarily unavailable; retry later', {
	headers: {'retry-after': '5'},
	status: 503
})

export class Auth extends Context.Service<
	Auth,
	{
		// Only a verified bearer names its client; an app session names just the person.
		readonly user: (headers: Headers.Headers) => Effect.Effect<User & {client?: string}, AuthError>
		readonly token: (headers: Headers.Headers) => Effect.Effect<string, AuthError>
	}
>()('@deslop/runtime/server/auth') {
	static readonly makeContext = (auth: typeof Auth.Service) =>
		pipe(
			Context.make(Auth, auth),
			Context.add(
				RpcAuth,
				RpcAuth.of((effect, request) =>
					pipe(
						auth.user(request.headers),
						Effect.flatMap(user =>
							Effect.raceFirst(
								Effect.provideService(effect, CurrentUser, user),
								// A watch outlives its token, so it ends once the credentials expire or are revoked; an auth restart does not end it.
								pipe(
									Effect.delay(auth.user(request.headers), '5 minutes'),
									Effect.retry({while: error => error.error === 'temporarily_unavailable'}),
									Effect.forever
								)
							)
						)
					)
				)
			)
		)

	static readonly layer = Layer.unwrap(
		Effect.gen(function* () {
			if (yield* localAuth) {
				return Layer.succeedContext(
					Auth.makeContext(
						Auth.of({
							token: () => Effect.fail(AuthError.make({message: 'There is no sign-in without --auth'})),
							user: () => Effect.succeed(DEVELOPER)
						})
					)
				)
			}
			return Layer.effectContext(
				Effect.gen(function* () {
					const issuer = yield* Config.String('AUTH_URL')
					const sessions = yield* Sessions
					const signature = yield* Signature.Signature
					// The key set must come from Auth's own URL, so its client never follows a redirect.
					const jwks = yield* pipe(
						Jwks.makeRemote({url: new URL(JWKS_PATH, issuer).href}),
						Effect.provideService(
							HttpClient.HttpClient,
							HttpClient.transform(
								yield* HttpClient.HttpClient,
								Effect.provideService(FetchHttpClient.RequestInit, {redirect: 'manual'})
							)
						)
					)
					const verified = Effect.fn('Auth.verify')(function* (token: string) {
						const access = yield* pipe(
							Jwt.verifyWithKeySet(AccessClaims, token, {
								algorithms: ['EdDSA'],
								audience: 'deslop',
								issuer: new URL(ISSUER_PATH, issuer).href,
								typ: 'at+jwt'
							}),
							Effect.provideService(Jwks.Jwks, jwks),
							Effect.provideService(Signature.Signature, signature),
							Effect.mapError(cause => {
								if (JoseError.isJoseError(cause) && cause.reason._tag === 'KeySetUnavailable') {
									return AuthError.make({
										cause,
										error: 'temporarily_unavailable',
										message: 'The authorization service is temporarily unavailable'
									})
								}
								return AuthError.make({cause, message: 'Sign in first'})
							})
						)
						yield* sessions.remember(token, access.claims)
						return {client: access.claims.azp, id: access.claims.sub, name: access.claims.name}
					})
					function session(headers: Headers.Headers) {
						return Option.match(sessionIdOf(headers), {
							onNone: () => Effect.fail(signInFirst),
							onSome: sessions.current
						})
					}
					return Auth.makeContext(
						Auth.of({
							token: headers =>
								Option.match(Option.filter(bearerOf(headers), isJwt), {
									onNone: () => Effect.map(session(headers), current => current.token),
									onSome: token => Effect.as(verified(token), token)
								}),
							user: headers =>
								Option.match(Option.filter(bearerOf(headers), isJwt), {
									onNone: () => Effect.map(session(headers), current => current.user),
									onSome: verified
								})
						})
					)
				})
			)
		})
	)
}

export const HttpAuth = HttpRouter.middleware<{provides: CurrentUser}>()(
	Effect.gen(function* () {
		const auth = yield* Auth
		return app =>
			Effect.gen(function* () {
				const user = yield* Effect.result(auth.user((yield* HttpServerRequest.HttpServerRequest).headers))
				if (Result.isFailure(user)) {
					if (user.failure.error === 'temporarily_unavailable') return unavailable
					return HttpServerResponse.text('Sign in first', {status: 401})
				}
				return yield* Effect.provideService(app, CurrentUser, user.success)
			})
	})
)

// MCP clients sign in with OAuth and send its access token; a session is not theirs to use.
export function layerMcpAuth(resource: string) {
	return HttpRouter.middleware<{provides: CurrentUser}>()(
		Effect.gen(function* () {
			const auth = yield* Auth
			// Without an issuer the MCP endpoint answers without OAuth, as its pages do.
			if (yield* localAuth) return app => Effect.provideService(app, CurrentUser, DEVELOPER)
			return app =>
				Effect.gen(function* () {
					const headers = (yield* HttpServerRequest.HttpServerRequest).headers
					const challenge = `Bearer resource_metadata="${new URL(MCP_METADATA_PATH, resource).href}", scope="deslop"`
					const bearer = bearerOf(headers)
					if (Option.isNone(bearer)) {
						return HttpServerResponse.text('OAuth authorization required; sign in with your MCP client', {
							headers: {'www-authenticate': challenge},
							status: 401
						})
					}
					const user = yield* Effect.result(
						Option.match(Option.filter(bearer, isJwt), {
							onNone: () => Effect.fail(signInFirst),
							onSome: () => auth.user(headers)
						})
					)
					if (Result.isFailure(user)) {
						if (user.failure.error === 'temporarily_unavailable') return unavailable
						return HttpServerResponse.text(
							'The access token is invalid or expired; your MCP client refreshes it, and asks you to sign in again only if refreshing fails',
							{headers: {'www-authenticate': `${challenge}, error="invalid_token"`}, status: 401}
						)
					}
					return yield* Effect.provideService(app, CurrentUser, user.success)
				})
		})
	).layer
}
