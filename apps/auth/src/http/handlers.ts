import {Boolean, Config, Effect, Option, Record, Schema, pipe} from 'effect'

import {Cookies, HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {localAuth} from '@deslop/runtime/server/auth'
import {
	AuthError,
	CLIENT_HEADER,
	IDENTIFY_PATH,
	IdentifyRequest,
	SESSION_COOKIE,
	UserId,
	failureOptions
} from '@deslop/runtime/shared/auth'
import {Account} from '@deslop/runtime/shared/schema'

import {parentDomain, returnable} from '#services/cookie-sessions/lib/utils.ts'
import {CookieSessions} from '#services/cookie-sessions/service.ts'
import {CallbackParams, OAuthState} from '#services/github/schema.ts'
import {GitHub} from '#services/github/service.ts'
import {Identity, isMachine} from '#services/identity/service.ts'
import {People} from '#services/people/service.ts'

const LOGIN_COOKIE = '__Host-login'
const COOKIE = {httpOnly: true, path: '/', sameSite: 'lax', secure: true} as const
function respond<E, R>(effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) {
	return pipe(
		effect,
		Effect.catchIf(Schema.is(AuthError), error =>
			Effect.succeed(HttpServerResponse.text(error.message, failureOptions(error, 401)))
		),
		Effect.map(HttpServerResponse.setHeader('cache-control', 'no-store'))
	)
}
export const HttpHandlers = HttpRouter.use(router =>
	Effect.gen(function* () {
		const identity = yield* Identity
		const github = yield* GitHub
		const people = yield* People
		const sessions = yield* CookieSessions
		const canonical = yield* Config.String('APP_URL')
		const local = yield* localAuth
		const sessionCookie = {
			...COOKIE,
			...Boolean.match(local, {onFalse: () => ({domain: parentDomain(canonical)}), onTrue: () => ({})}),
			maxAge: '365 days' as const
		}
		function nextOf(request: HttpServerRequest.HttpServerRequest) {
			const next = new URL(request.url, canonical).searchParams.get('next') ?? canonical
			if (!returnable(next, canonical, local)) {
				return Effect.fail(AuthError.make({error: 'access_denied', message: 'Invalid return URL'}))
			}
			return Effect.succeed(next)
		}
		yield* router.add(
			'POST',
			IDENTIFY_PATH,
			respond(
				Effect.gen(function* () {
					if (!isMachine((yield* HttpServerRequest.HttpServerRequest).headers[CLIENT_HEADER] ?? '')) {
						return HttpServerResponse.text('Only this machine may identify callers', {status: 403})
					}
					return yield* HttpServerResponse.schemaJson(Account)(
						yield* identity.resolve(yield* HttpServerRequest.schemaBodyJson(IdentifyRequest))
					)
				})
			)
		)
		yield* router.add(
			'GET',
			'/sign-in',
			respond(
				Effect.gen(function* () {
					const started = yield* github.start({next: yield* nextOf(yield* HttpServerRequest.HttpServerRequest)})
					return HttpServerResponse.setCookieUnsafe(
						HttpServerResponse.redirect(started.url),
						LOGIN_COOKIE,
						started.state,
						{...COOKIE, maxAge: '10 minutes'}
					)
				})
			)
		)
		yield* router.add(
			'GET',
			'/auth/github/callback',
			respond(
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					const params = yield* Schema.decodeUnknownEffect(CallbackParams)(
						Record.fromEntries(new URL(request.url, canonical).searchParams)
					)
					if (Cookies.parseHeader(request.headers['cookie'] ?? '')[LOGIN_COOKIE] !== params.state) {
						return yield* AuthError.make({error: 'access_denied', message: 'This browser did not start the sign-in'})
					}
					const result = yield* github.finish(params.code, OAuthState.make(params.state))
					const member = yield* people.register(
						{id: UserId.make(`github:${result.profile.id}`), name: result.profile.login},
						result.profile.name,
						false
					)
					const secret = yield* sessions.create(
						member.id,
						Option.fromNullishOr(request.headers[CLIENT_HEADER]),
						request.headers['user-agent'] ?? 'Browser'
					)
					const account = yield* identity.resolve(
						IdentifyRequest.make({address: Option.none(), onBehalfOf: Option.none(), session: Option.some(secret)}),
						true
					)
					return pipe(
						HttpServerResponse.redirect(
							Boolean.match(account.role === 'Waiting', {
								onFalse: () => result.flow.next,
								onTrue: () => `/?${new URLSearchParams({next: result.flow.next})}`
							})
						),
						HttpServerResponse.setCookieUnsafe(SESSION_COOKIE, secret, sessionCookie),
						HttpServerResponse.expireCookieUnsafe(LOGIN_COOKIE, COOKIE)
					)
				})
			)
		)
		yield* router.add(
			'GET',
			'/sign-out',
			respond(
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					const next = yield* nextOf(request)
					const secret = Cookies.parseHeader(request.headers['cookie'] ?? '')[SESSION_COOKIE]
					if (secret) yield* sessions.forget(secret)
					return HttpServerResponse.expireCookieUnsafe(HttpServerResponse.redirect(next), SESSION_COOKIE, sessionCookie)
				})
			)
		)
	})
)
