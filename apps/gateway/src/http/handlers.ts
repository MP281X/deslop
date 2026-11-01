import {Effect, Option, pipe} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {AuthError} from '@deslop/runtime/auth/schema'
import {Auth} from '@deslop/runtime/auth/service'
import {signInUrl} from '@deslop/runtime/auth/utils'

import {clientMetadata, gatewayUrl} from '#services/connections/lib/utils.ts'
import {Callback, ServerParams} from '#services/connections/schema.ts'
import {Connections} from '#services/connections/service.ts'

const COOKIE = {httpOnly: true, path: '/', sameSite: 'lax', secure: true} as const

// Connecting a provider returns to the servers page, whose row shows why a step failed.
export const HttpHandlers = HttpRouter.use(router =>
	Effect.gen(function* () {
		const auth = yield* Auth
		const connections = yield* Connections
		const url = yield* gatewayUrl
		yield* router.add('GET', '/oauth/client.json', HttpServerResponse.jsonUnsafe(clientMetadata(url)))
		yield* router.add(
			'GET',
			'/oauth/connect',
			pipe(
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					const params = yield* HttpServerRequest.schemaSearchParams(ServerParams)
					return yield* Option.match(yield* Effect.option(auth.user(request.headers)), {
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
											{...COOKIE, maxAge: '10 minutes'}
										)
								})
							)
					})
				}),
				Effect.orElseSucceed(() => HttpServerResponse.redirect('/')),
				Effect.map(HttpServerResponse.setHeader('cache-control', 'no-store'))
			)
		)
		// A provider the gateway registered with answers at its server's own callback; one using the metadata document at the shared one.
		const callback = Effect.fnUntraced(
			function* (route: Option.Option<string>) {
				const request = yield* HttpServerRequest.HttpServerRequest
				const user = yield* auth.user(request.headers)
				const params = yield* HttpServerRequest.schemaSearchParams(Callback)
				if (request.cookies[`__Host-mcp-${params.state}`] !== params.state) {
					return yield* AuthError.make({message: 'The connection belongs to another browser'})
				}
				yield* connections.complete(params, route, user)
				return HttpServerResponse.expireCookieUnsafe(
					HttpServerResponse.redirect('/'),
					`__Host-mcp-${params.state}`,
					COOKIE
				)
			},
			Effect.orElseSucceed(() => HttpServerResponse.redirect('/')),
			Effect.map(HttpServerResponse.setHeader('cache-control', 'no-store'))
		)
		yield* router.add('GET', '/oauth/callback', callback(Option.none()))
		yield* router.add(
			'GET',
			'/oauth/callback/:id',
			Effect.flatMap(HttpRouter.params, params => callback(Option.fromUndefinedOr(params['id'])))
		)
	})
)
