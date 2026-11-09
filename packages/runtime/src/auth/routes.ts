import {Config, Effect, Layer, Option, Result, Schema, String, pipe} from 'effect'

import {Digest, SecureRandom} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import type {Headers} from 'effect/http'
import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {appName} from '#server.ts'

import {
	AUTHORIZE_PATH,
	CALLBACK_PATH,
	ISSUER_PATH,
	SESSION_COOKIE,
	clientIdOf,
	failureOptions,
	rejected
} from '#auth/lib/utils.ts'
import {AuthError, CodeGrant, SessionHandle} from '#auth/schema.ts'
import {Sessions, sessionIdOf} from '#auth/sessions.ts'

const COOKIE = {httpOnly: true, path: '/', sameSite: 'lax', secure: true} as const
const SIGN_IN_COOKIE = '__Host-sign-in'

type SignInState = typeof SignInState.Type
const SignInState = Schema.fromJsonString(
	Schema.Struct({next: Schema.String, state: Schema.String, verifier: Schema.String})
)

type CallbackParams = typeof CallbackParams.Type
const CallbackParams = Schema.Struct({
	code: Schema.optionalKey(Schema.String),
	error: Schema.optionalKey(Schema.String),
	iss: Schema.optionalKey(Schema.String),
	state: Schema.optionalKey(Schema.String)
})

function signedOut(next: string, cause: unknown) {
	return Effect.as(
		Effect.logWarning('The sign-in did not complete', cause),
		HttpServerResponse.expireCookieUnsafe(HttpServerResponse.redirect(next), SIGN_IN_COOKIE, COOKIE)
	)
}

// This app's own sign-in through Auth, kept as a session on its server: a browser holds the session's id in a cookie, a phone as its bearer.
function layerSignIn(issuer: string) {
	return HttpRouter.use(router =>
		Effect.gen(function* () {
			const sessions = yield* Sessions
			const random = yield* SecureRandom.SecureRandom
			const digest = yield* Digest.Digest
			const canonical = new URL(yield* Config.String('APP_URL')).origin
			const callback = new URL(CALLBACK_PATH, canonical).href
			const clientId = yield* Effect.cached(
				Effect.map(appName, name => clientIdOf({name: String.capitalize(name), redirects: [callback]}))
			)
			function ended(headers: Headers.Headers) {
				return Option.match(sessionIdOf(headers), {
					onNone: () => Effect.void,
					onSome: id => Effect.ignore(sessions.end(id), {log: 'Warn', message: 'The session could not be ended'})
				})
			}
			// A destination on this app only, so the round trip through Auth cannot be turned into an open redirect.
			function toNext<E, R>(
				handle: (
					request: HttpServerRequest.HttpServerRequest,
					next: URL
				) => Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
			) {
				return Effect.flatMap(HttpServerRequest.HttpServerRequest, request =>
					Option.match(
						Option.filter(
							Option.liftThrowable(
								() => new URL(new URL(request.url, canonical).searchParams.get('next') ?? canonical, canonical)
							)(),
							next => next.origin === canonical
						),
						{
							onNone: () => Effect.succeed(HttpServerResponse.empty({status: 400})),
							onSome: next => handle(request, next)
						}
					)
				)
			}
			yield* router.add(
				'GET',
				'/auth/sign-in',
				toNext(
					Effect.fnUntraced(function* (_, next) {
						const verifier = Base64Url.encode(yield* random.randomBytes(32))
						const state = Base64Url.encode(yield* random.randomBytes(16))
						const authorize = new URL(AUTHORIZE_PATH, issuer)
						authorize.search = `${new URLSearchParams({
							client_id: yield* clientId,
							code_challenge: Base64Url.encode(yield* digest.digest(Digest.sha256, new TextEncoder().encode(verifier))),
							code_challenge_method: 'S256',
							redirect_uri: callback,
							response_type: 'code',
							scope: 'deslop offline_access',
							state
						})}`
						return HttpServerResponse.setCookieUnsafe(
							HttpServerResponse.redirect(authorize.href),
							SIGN_IN_COOKIE,
							yield* Schema.encodeEffect(SignInState)({next: next.href, state, verifier}),
							{...COOKIE, maxAge: '10 minutes'}
						)
					})
				)
			)
			yield* router.add(
				'GET',
				CALLBACK_PATH,
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					return yield* Option.match(
						yield* Effect.option(Schema.decodeUnknownEffect(SignInState)(request.cookies[SIGN_IN_COOKIE])),
						{
							onNone: () => signedOut(canonical, 'The sign-in expired or began in another browser'),
							onSome: Effect.fnUntraced(function* (saved) {
								const started = yield* Effect.result(
									Effect.gen(function* () {
										const params = yield* HttpServerRequest.schemaSearchParams(CallbackParams)
										if (params.state !== saved.state) {
											return yield* AuthError.make({message: 'The sign-in began in another browser'})
										}
										if (params.error !== undefined || params.code === undefined) {
											return yield* AuthError.make({message: `Auth answered ${params.error ?? 'without a code'}`})
										}
										if (params.iss !== new URL(ISSUER_PATH, issuer).href) {
											return yield* AuthError.make({message: 'The answer came from another issuer'})
										}
										return yield* sessions.start({
											client_id: yield* clientId,
											code: params.code,
											code_verifier: saved.verifier,
											redirect_uri: callback
										})
									})
								)
								if (Result.isFailure(started)) return yield* signedOut(saved.next, started.failure)
								return pipe(
									HttpServerResponse.redirect(saved.next),
									HttpServerResponse.expireCookieUnsafe(SIGN_IN_COOKIE, COOKIE),
									// The server decides how long a session lasts, so the cookie outlives any of them.
									HttpServerResponse.setCookieUnsafe(SESSION_COOKIE, started.success, {...COOKIE, maxAge: '365 days'})
								)
							})
						}
					)
				})
			)
			yield* router.add(
				'POST',
				'/auth/session',
				Effect.gen(function* () {
					const started = yield* Effect.result(
						pipe(
							HttpServerRequest.schemaBodyJson(CodeGrant),
							rejected('The sign-in request is invalid'),
							Effect.flatMap(sessions.start)
						)
					)
					if (Result.isFailure(started)) {
						return HttpServerResponse.text(started.failure.message, failureOptions(started.failure, 400))
					}
					return yield* HttpServerResponse.schemaJson(SessionHandle)(
						{session: started.success},
						{headers: {'cache-control': 'no-store'}}
					)
				})
			)
			// Signing out also ends the browser's sign-in at Auth, and with it every app session it started.
			yield* router.add(
				'GET',
				'/auth/sign-out',
				toNext((request, next) =>
					Effect.as(
						ended(request.headers),
						HttpServerResponse.expireCookieUnsafe(
							HttpServerResponse.redirect(
								`${new URL('/', issuer).href}?${new URLSearchParams({next: next.href, 'sign-out': ''})}`
							),
							SESSION_COOKIE,
							COOKIE
						)
					)
				)
			)
			yield* router.add(
				'POST',
				'/auth/sign-out',
				Effect.as(
					Effect.flatMap(HttpServerRequest.HttpServerRequest, request => ended(request.headers)),
					HttpServerResponse.empty({status: 204})
				)
			)
		})
	)
}

// Without an issuer every request is the developer, so there are no sign-in routes.
export const layerSessionRoutes = Layer.unwrap(
	Effect.gen(function* () {
		return Option.match(yield* Config.option(Config.String('AUTH_URL')), {
			onNone: () => Layer.empty,
			onSome: layerSignIn
		})
	})
)
