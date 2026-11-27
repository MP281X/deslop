import {Array, Boolean, Config, Effect, Option, pipe} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {localAuth} from '@deslop/runtime/server/auth'
import {SESSION_COOKIE} from '@deslop/runtime/shared/auth'

import {parentDomain} from '#contracts'

import {AppSignIn} from '#server/github/schema.ts'
import {authResponse} from '#server/http.ts'
import {SignIns, loginCookie} from '#server/sign-ins/service.ts'

const COOKIE = {httpOnly: true, path: '/', sameSite: 'lax', secure: true} as const

const association = {
	webcredentials: {
		apps: Array.flatMap(AppSignIn.fields.app.literals, slug =>
			Array.map(['', '.dev'], suffix => `99K7MQUK7F.xyz.mp281x.${slug}${suffix}`)
		)
	}
}

export const SignInsHttp = HttpRouter.use(router =>
	Effect.gen(function* () {
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
			'GET',
			'/sign-in',
			authResponse(
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
			authResponse(
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
			authResponse(
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
