import {Duration, Effect, Option, Schema, String, pipe} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {Auth} from '@deslop/runtime/server/auth'
import {AuthError, signInUrl} from '@deslop/runtime/shared/auth'

import {AiProxy} from '#services/ai-proxy/service.ts'
import {clientMetadata} from '#services/connections/lib/utils.ts'
import type {ServerId} from '#services/connections/schema.ts'
import {Callback, ServerParams} from '#services/connections/schema.ts'
import {Connections, gatewayUrl} from '#services/connections/service.ts'
import {Gateway} from '#services/gateway/service.ts'

const COOKIE = {httpOnly: true, path: '/', sameSite: 'lax', secure: true} as const

// judge-ignore no-silent-fallback -- Failed OAuth flows return to the server row that records the issue; auth and storage outages remain HTTP failures.
// A step's answer is never cached.
function returning<E, R>(step: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) {
	return pipe(
		step,
		Effect.tapError(cause => Effect.logWarning('The sign-in callback could not be completed', cause)),
		Effect.catch(error => {
			if (
				Schema.is(AuthError)(error) &&
				(error.error === 'temporarily_unavailable' || error.error === 'access_denied')
			) {
				return Effect.fail(error)
			}
			return Effect.succeed(HttpServerResponse.redirect('/'))
		}),
		Effect.map(HttpServerResponse.setHeader('cache-control', 'no-store'))
	)
}

export const HttpHandlers = HttpRouter.use(router =>
	Effect.gen(function* () {
		const auth = yield* Auth
		const connections = yield* Connections
		const gateway = yield* Gateway
		const url = yield* gatewayUrl
		yield* router.add('GET', '/oauth/client.json', HttpServerResponse.jsonUnsafe(clientMetadata(url)))
		yield* router.add(
			'GET',
			'/oauth/connect',
			returning(
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					const params = yield* HttpServerRequest.schemaSearchParams(ServerParams)
					return yield* Option.match(
						yield* pipe(
							auth.user(request.headers),
							Effect.asSome,
							Effect.catchTag('AuthError', error => {
								if (error.error === 'temporarily_unavailable') return Effect.fail(error)
								return Effect.succeedNone
							})
						),
						{
							onNone: () => Effect.succeed(HttpServerResponse.redirect(signInUrl(`${url}${request.url}`))),
							onSome: user =>
								Effect.map(connections.begin(params.id, user), started =>
									Option.match(started.state, {
										onNone: () => HttpServerResponse.redirect(started.url),
										onSome: state =>
											HttpServerResponse.setCookieUnsafe(
												HttpServerResponse.redirect(started.url),
												`__Host-mcp-${state}`,
												state,
												{...COOKIE, maxAge: Duration.minutes(10)}
											)
									})
								)
						}
					)
				})
			)
		)
		// A provider the gateway registered with answers at its server's own callback; one using the metadata document at the shared one.
		const callback = Effect.fnUntraced(function* (route: Option.Option<ServerId>) {
			const request = yield* HttpServerRequest.HttpServerRequest
			const user = yield* auth.user(request.headers)
			const params = yield* HttpServerRequest.schemaSearchParams(Callback)
			if (request.cookies[`__Host-mcp-${params.state}`] !== params.state) {
				return yield* AuthError.make({message: 'The connection belongs to another browser'})
			}
			yield* connections.complete(params, route, user)
			// Its tools are read now, not at an agent's next tools/list.
			yield* gateway.connected(request.headers)
			return HttpServerResponse.expireCookieUnsafe(
				HttpServerResponse.redirect('/'),
				`__Host-mcp-${params.state}`,
				COOKIE
			)
		}, returning)
		yield* router.add('GET', '/oauth/callback', callback(Option.none()))
		yield* router.add(
			'GET',
			'/oauth/callback/:id',
			Effect.flatMap(HttpRouter.schemaParams(ServerParams), params => callback(Option.some(params.id)))
		)
	})
)

export const AiHttpHandlers = HttpRouter.use(router =>
	Effect.gen(function* () {
		const ai = yield* AiProxy
		yield* router.add(
			'*',
			'/ai/*',
			Effect.gen(function* () {
				return yield* ai.proxy(String.slice('/ai/'.length)((yield* HttpServerRequest.HttpServerRequest).url))
			})
		)
	})
)
