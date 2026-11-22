import {Boolean, Config, Effect, Option, Schema, pipe} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {localAuth} from '@deslop/runtime/server/auth'
import {
	AuthError,
	CLIENT_HEADER,
	IDENTIFY_PATH,
	IdentifyRequest,
	SESSION_COOKIE,
	failureOptions
} from '@deslop/runtime/shared/auth'
import {Account} from '@deslop/runtime/shared/schema'

import {Identity, isMachine} from '#services/identity/service.ts'
import {parentDomain} from '#services/sessions/lib/utils.ts'
import {SignIns, association, loginCookie} from '#services/sign-ins/service.ts'

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
		const signIns = yield* SignIns
		const canonical = yield* Config.String('APP_URL')
		const sessionCookie = {
			...COOKIE,
			...Boolean.match(yield* localAuth, {onFalse: () => ({domain: parentDomain(canonical)}), onTrue: () => ({})}),
			maxAge: '365 days' as const
		}
		yield* router.add(
			'GET',
			'/.well-known/apple-app-site-association',
			Effect.succeed(HttpServerResponse.jsonUnsafe(association))
		)
		yield* router.add(
			'POST',
			IDENTIFY_PATH,
			respond(
				Effect.gen(function* () {
					if (!isMachine((yield* HttpServerRequest.HttpServerRequest).headers[CLIENT_HEADER] ?? '')) {
						return HttpServerResponse.text('Only this machine may identify callers', {status: 403})
					}
					return yield* HttpServerResponse.schemaJson(Account)(
						yield* identity.resolve(
							yield* Effect.mapError(HttpServerRequest.schemaBodyJson(IdentifyRequest), cause =>
								AuthError.make({cause, error: 'access_denied', message: 'Invalid identify request'})
							)
						)
					)
				})
			)
		)
		yield* router.add(
			'GET',
			'/sign-in',
			respond(
				Effect.gen(function* () {
					const started = yield* signIns.start(
						new URL((yield* HttpServerRequest.HttpServerRequest).url, canonical).searchParams
					)
					return HttpServerResponse.setCookieUnsafe(
						HttpServerResponse.redirect(started.url),
						loginCookie(started.state),
						started.sealed,
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
					const result = yield* signIns.finish(new URL(request.url, canonical).searchParams, request.headers)
					return pipe(
						HttpServerResponse.redirect(result.target),
						response =>
							Option.match(result.session, {
								onNone: () => response,
								onSome: secret => HttpServerResponse.setCookieUnsafe(response, SESSION_COOKIE, secret, sessionCookie)
							}),
						HttpServerResponse.expireCookieUnsafe(loginCookie(result.state), COOKIE)
					)
				})
			)
		)
		yield* router.add(
			'POST',
			'/sign-out',
			respond(
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					return HttpServerResponse.expireCookieUnsafe(
						HttpServerResponse.redirect(
							yield* signIns.signOut(new URL(request.url, canonical).searchParams, request.headers),
							{status: 303}
						),
						SESSION_COOKIE,
						sessionCookie
					)
				})
			)
		)
	})
)
