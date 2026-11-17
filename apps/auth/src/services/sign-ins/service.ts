import {Array, Boolean, Config, Context, Effect, Layer, Option, Record, Schema, pipe} from 'effect'

import {Cookies} from 'effect/http'
import type {Headers} from 'effect/http'

import {localAuth} from '@deslop/runtime/server/auth'
import {AuthError, CLIENT_HEADER, IdentifyRequest, SESSION_COOKIE, UserId} from '@deslop/runtime/shared/auth'

import {returnable} from '#services/cookie-sessions/lib/utils.ts'
import {CookieSessions} from '#services/cookie-sessions/service.ts'
import type {OAuthState} from '#services/github/schema.ts'
import {AppSignIn, CallbackParams} from '#services/github/schema.ts'
import {GitHub} from '#services/github/service.ts'
import {Identity} from '#services/identity/service.ts'
import {People} from '#services/people/service.ts'

export function loginCookie(state: string) {
	return `__Host-login-${state}`
}

export const association = {
	webcredentials: {
		apps: Array.flatMap(['opm', 'stash', 'trips'], slug =>
			Array.map(['', '.dev'], suffix => `99K7MQUK7F.xyz.mp281x.${slug}${suffix}`)
		)
	}
}

export class SignIns extends Context.Service<
	SignIns,
	{
		readonly start: (query: URLSearchParams) => Effect.Effect<{state: OAuthState; url: string}, AuthError>
		readonly finish: (
			query: URLSearchParams,
			headers: Headers.Headers
		) => Effect.Effect<{state: OAuthState; target: string; session: Option.Option<string>}, AuthError>
		readonly signOut: (query: URLSearchParams, headers: Headers.Headers) => Effect.Effect<string, AuthError>
	}
>()('@deslop/auth/services/sign-ins/service/SignIns') {
	static readonly layer = Layer.effect(
		SignIns,
		Effect.gen(function* () {
			const github = yield* GitHub
			const people = yield* People
			const sessions = yield* CookieSessions
			const identity = yield* Identity
			const canonical = yield* Config.String('APP_URL')
			const local = yield* localAuth
			function nextOf(query: URLSearchParams) {
				const next = query.get('next') ?? canonical
				if (returnable(next, canonical, local)) return Effect.succeed(next)
				return Effect.fail(AuthError.make({error: 'access_denied', message: 'Invalid return URL'}))
			}
			return SignIns.of({
				finish: Effect.fn('SignIns.finish')(function* (query, headers) {
					if (query.has('error')) {
						return yield* AuthError.make({error: 'access_denied', message: 'GitHub sign-in was cancelled'})
					}
					const params = yield* Effect.mapError(
						Schema.decodeUnknownEffect(CallbackParams)(Record.fromEntries(query)),
						cause => AuthError.make({cause, error: 'access_denied', message: 'Invalid GitHub callback'})
					)
					if (Cookies.parseHeader(headers['cookie'] ?? '')[loginCookie(params.state)] !== params.state) {
						return yield* AuthError.make({error: 'access_denied', message: 'This browser did not start the sign-in'})
					}
					const result = yield* github.finish(params.code, params.state)
					const secret = yield* sessions.create(
						(yield* people.register(
							{id: UserId.make(`github:${result.profile.id}`), name: result.profile.login},
							result.profile.name,
							false
						)).id,
						Option.fromNullishOr(headers[CLIENT_HEADER]),
						headers['user-agent'] ?? 'Browser'
					)
					const account = yield* identity.resolve(
						IdentifyRequest.make({address: Option.none(), onBehalfOf: Option.none(), session: Option.some(secret)}),
						true
					)
					return Option.match(result.flow.app, {
						onNone: () => ({
							session: Option.some(secret),
							state: params.state,
							target: Boolean.match(account.role === 'Waiting', {
								onFalse: () => result.flow.next,
								onTrue: () => `/?${new URLSearchParams({next: result.flow.next})}`
							})
						}),
						onSome: app => ({
							session: Option.none<string>(),
							state: params.state,
							target: new URL(`/signed-in/${app.app}?${new URLSearchParams({session: secret})}`, canonical).href
						})
					})
				}),
				signOut: Effect.fn('SignIns.signOut')(function* (query, headers) {
					if (headers['origin'] !== new URL(canonical).origin) {
						return yield* AuthError.make({
							error: 'access_denied',
							message: 'Invalid sign-out origin; no changes committed'
						})
					}
					const next = yield* nextOf(query)
					const secret = Cookies.parseHeader(headers['cookie'] ?? '')[SESSION_COOKIE]
					if (secret) yield* sessions.forget(secret)
					return next
				}),
				start: Effect.fn('SignIns.start')(function* (query) {
					const app = yield* Boolean.match(query.has('app'), {
						onFalse: () => Effect.succeedNone,
						onTrue: () =>
							pipe(
								Schema.decodeUnknownEffect(AppSignIn)(Record.fromEntries(query)),
								Effect.asSome,
								Effect.mapError(cause =>
									AuthError.make({cause, error: 'access_denied', message: 'Invalid app sign-in'})
								)
							)
					})
					return yield* github.start({
						app,
						next: yield* Option.match(app, {onNone: () => nextOf(query), onSome: () => Effect.succeed(canonical)})
					})
				})
			})
		})
	)
}
