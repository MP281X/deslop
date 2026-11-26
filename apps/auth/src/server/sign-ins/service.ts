import {Boolean, Config, Context, Effect, Layer, Option, Record, Schema, pipe} from 'effect'

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

import {returnTarget} from '#contracts'

import {AppSignIn, CallbackParams, GitHubOAuthState} from '#server/github/schema.ts'
import {GitHub} from '#server/github/service.ts'
import {Identity} from '#server/identity/service.ts'
import {People} from '#server/people/service.ts'
import {Sessions} from '#server/sessions/service.ts'

export function loginCookie(state: string) {
	return `__Host-login-${state}`
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
>()('@deslop/auth/server/sign-ins/service/SignIns') {
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
					const state = yield* Effect.mapError(
						Schema.decodeUnknownEffect(GitHubOAuthState)(query.get('state')),
						cause => AuthError.make({cause, error: 'access_denied', message: 'Invalid GitHub callback'})
					)
					const pending = yield* github.resume(
						state,
						Cookies.parseHeader(headers['cookie'] ?? '')[loginCookie(state)] ?? ''
					)
					// Only a flow this browser started hears why GitHub ended it; a callback that matches none is refused above.
					return yield* pipe(
						Effect.succeed(query),
						Effect.filterOrFail(
							params => !params.has('error'),
							() => AuthError.make({error: 'access_denied', message: 'GitHub sign-in was cancelled'})
						),
						Effect.flatMap(params =>
							Effect.mapError(Schema.decodeUnknownEffect(CallbackParams)(Record.fromEntries(params)), cause =>
								AuthError.make({cause, error: 'access_denied', message: 'Invalid GitHub callback'})
							)
						),
						Effect.flatMap(params => github.finish(params.code, pending)),
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
									state,
									target: Boolean.match(signed.account.role === 'Waiting', {
										onFalse: () => pending.next,
										onTrue: () => `/?${new URLSearchParams({next: pending.next})}`
									})
								}),
								onSome: app => ({
									session: Option.none<string>(),
									state,
									target: new URL(`/signed-in/${app.app}?${new URLSearchParams({session: signed.secret})}`, canonical)
										.href
								})
							})
						),
						// GitHub has spent the code by now, so the person lands where a new sign-in starts, told why this one failed.
						Effect.catchTag('AuthError', error =>
							Effect.succeed({
								session: Option.none<string>(),
								state,
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
