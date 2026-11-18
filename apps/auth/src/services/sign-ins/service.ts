import {Array, Boolean, Config, Context, Effect, Layer, Option, Record, Schema, pipe} from 'effect'

import {Cookies} from 'effect/http'
import type {Headers} from 'effect/http'
import {SqlClient} from 'effect/sql'

import {localAuth} from '@deslop/runtime/server/auth'
import {
	AuthError,
	CLIENT_HEADER,
	IdentifyRequest,
	SESSION_COOKIE,
	UserId,
	asAuthError
} from '@deslop/runtime/shared/auth'

import type {GitHubOAuthState} from '#services/github/schema.ts'
import {AppSignIn, CallbackParams} from '#services/github/schema.ts'
import {GitHub} from '#services/github/service.ts'
import {Identity} from '#services/identity/service.ts'
import {People} from '#services/people/service.ts'
import {returnTarget} from '#services/sessions/lib/utils.ts'
import {Sessions} from '#services/sessions/service.ts'

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
		readonly start: (
			query: URLSearchParams
		) => Effect.Effect<{sealed: string; state: GitHubOAuthState; url: string}, AuthError>
		readonly finish: (
			query: URLSearchParams,
			headers: Headers.Headers
		) => Effect.Effect<{state: GitHubOAuthState; target: string; session: Option.Option<string>}, AuthError>
		readonly signOut: (query: URLSearchParams, headers: Headers.Headers) => Effect.Effect<string, AuthError>
	}
>()('@deslop/auth/services/sign-ins/service/SignIns') {
	static readonly layer = Layer.effect(
		SignIns,
		Effect.gen(function* () {
			const github = yield* GitHub
			const people = yield* People
			const sessions = yield* Sessions
			const identity = yield* Identity
			const sql = yield* SqlClient.SqlClient
			const canonical = yield* Config.String('APP_URL')
			const local = yield* localAuth
			function nextOf(query: URLSearchParams) {
				return pipe(
					returnTarget(query.get('next') ?? canonical, canonical, local),
					Effect.fromOption,
					Effect.mapError(() => AuthError.make({error: 'access_denied', message: 'Invalid return URL'}))
				)
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
					const pending = yield* github.resume(
						params.state,
						Cookies.parseHeader(headers['cookie'] ?? '')[loginCookie(params.state)] ?? ''
					)
					return yield* pipe(
						github.finish(params.code, pending),
						// The person, their session and the answer they get commit together, so an admin's decision lands before or after the whole sign-in.
						Effect.flatMap(profile =>
							sql.withTransaction(
								Effect.gen(function* () {
									const secret = yield* sessions.create(
										(yield* people.register(
											{id: UserId.make(`github:${profile.id}`), name: profile.login},
											profile.name,
											false
										)).id,
										Option.fromNullishOr(headers[CLIENT_HEADER]),
										headers['user-agent'] ?? 'Browser'
									)
									const account = yield* identity.resolve(
										IdentifyRequest.make({
											address: Option.none(),
											onBehalfOf: Option.none(),
											session: Option.some(secret)
										}),
										true
									)
									return {account, secret}
								})
							)
						),
						asAuthError('Cannot finish the sign-in'),
						Effect.map(signed =>
							Option.match(pending.app, {
								onNone: () => ({
									session: Option.some(signed.secret),
									state: params.state,
									target: Boolean.match(signed.account.role === 'Waiting', {
										onFalse: () => pending.next,
										onTrue: () => `/?${new URLSearchParams({next: pending.next})}`
									})
								}),
								onSome: app => ({
									session: Option.none<string>(),
									state: params.state,
									target: new URL(`/signed-in/${app.app}?${new URLSearchParams({session: signed.secret})}`, canonical)
										.href
								})
							})
						),
						// GitHub has spent the code by now, so the person lands where a new sign-in starts, told why this one failed.
						Effect.catchTag('AuthError', error =>
							Effect.succeed({
								session: Option.none<string>(),
								state: params.state,
								target: Option.match(pending.app, {
									onNone: () => `/?${new URLSearchParams({error: error.message, next: pending.next})}`,
									onSome: app =>
										new URL(`/signed-in/${app.app}?${new URLSearchParams({error: error.message})}`, canonical).href
								})
							})
						)
					)
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
