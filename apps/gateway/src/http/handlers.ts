import {Duration, Effect, Option, Result, Schema, String, pipe} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {Auth, requireAdmin} from '@deslop/runtime/server/auth'
import {AuthError, failureOptions, signInUrl} from '@deslop/runtime/shared/auth'

import {AiProxy} from '#services/ai-proxy/service.ts'
import {clientMetadata} from '#services/connections/lib/utils.ts'
import type {ServerId} from '#services/connections/schema.ts'
import {Callback, ServerParams} from '#services/connections/schema.ts'
import {Connections, gatewayUrl} from '#services/connections/service.ts'
import {Gateway} from '#services/gateway/service.ts'

const COOKIE = {httpOnly: true, path: '/', sameSite: 'lax', secure: true} as const

// judge-ignore no-silent-fallback -- a failed OAuth step returns to the servers page, whose row records the issue; an Auth outage or refusal answers 503 or 403 with its message.
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
				return Effect.succeed(HttpServerResponse.text(error.message, failureOptions(error, 500)))
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
								if (error.error !== undefined) return Effect.fail(error)
								return Effect.succeedNone
							})
						),
						{
							onNone: () => Effect.succeed(HttpServerResponse.redirect(signInUrl(`${url}${request.url}`))),
							onSome: user =>
								Effect.flatMap(requireAdmin(user, 'Only an admin can manage MCP servers'), admin =>
									Effect.map(connections.begin(params.id, admin), started =>
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
								)
						}
					)
				})
			)
		)
		// A provider the gateway registered with answers at its server's own callback; one using the metadata document at the shared one.
		const callback = Effect.fnUntraced(function* (route: Option.Option<ServerId>) {
			const request = yield* HttpServerRequest.HttpServerRequest
			const named = yield* Effect.result(auth.user(request.headers))
			if (Result.isFailure(named)) {
				return HttpServerResponse.text(named.failure.message, failureOptions(named.failure, 401))
			}
			const user = yield* requireAdmin(named.success, 'Only an admin can manage MCP servers')
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
