import {Config, Context, Effect, Layer, Option, Result, pipe} from 'effect'

import {Signature} from 'effect/crypto'
import type {Headers} from 'effect/http'
import {FetchHttpClient, HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'
import {JoseError, Jwks, Jwt} from 'effect/jose'
import {RpcSchema} from 'effect/rpc'

import {MCP_METADATA_PATH} from '#schema.ts'

import {AiGateway} from '#ai/service.ts'
import {CurrentUser, DEVELOPER, ISSUER_PATH, JWKS_PATH, RpcAuth, bearerOf, localAuth} from '#auth/lib/utils.ts'
import {AccessClaims, AuthError} from '#auth/schema.ts'
import type {User} from '#auth/schema.ts'
import {Sessions, isJwt, sessionIdOf} from '#auth/sessions.ts'

function enrolled(auth: typeof Auth.Service, user: User, headers: Headers.Headers) {
	return Effect.gen(function* () {
		const gateway = Context.getOrUndefined(yield* Effect.context(), AiGateway)
		if (gateway !== undefined) yield* gateway.enroll(user.id, auth.token(headers))
	})
}

const signInFirst = AuthError.make({message: 'Sign in first'})

const unavailable = HttpServerResponse.text('The authorization service is temporarily unavailable; retry later', {
	headers: {'retry-after': '5'},
	status: 503
})

export class Auth extends Context.Service<
	Auth,
	{
		// Who sent the request: a verified access token, or the app's own session (cookie or a non-JWT bearer).
		readonly user: (headers: Headers.Headers) => Effect.Effect<User, AuthError>
		// The access token the request acts with: the bearer JWT as sent, or the session's current one, refreshed when needed.
		readonly token: (headers: Headers.Headers) => Effect.Effect<string, AuthError>
	}
>()('@deslop/runtime/auth/service/Auth') {
	static readonly makeContext = (auth: typeof Auth.Service) =>
		pipe(
			Context.make(Auth, auth),
			Context.add(
				RpcAuth,
				RpcAuth.of((effect, request) =>
					pipe(
						auth.user(request.headers),
						Effect.tap(user => enrolled(auth, user, request.headers)),
						Effect.tap(() => {
							if (RpcSchema.isStreamSchema(request.rpc.successSchema)) {
								return Effect.annotateCurrentSpan('rpc.stream', true)
							}
							return Effect.void
						}),
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

	// A bearer access token is checked against Auth's public keys; anything else is this app's own session.
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
						return {id: access.claims.sub, name: access.claims.name}
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
									onSome: Effect.succeed
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
				const headers = (yield* HttpServerRequest.HttpServerRequest).headers
				const user = yield* Effect.result(auth.user(headers))
				if (Result.isFailure(user)) {
					if (user.failure.error === 'temporarily_unavailable') return unavailable
					return HttpServerResponse.text('Sign in first', {status: 401})
				}
				yield* enrolled(auth, user.success, headers)
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
					yield* enrolled(auth, user.success, headers)
					return yield* Effect.provideService(app, CurrentUser, user.success)
				})
		})
	).layer
}
