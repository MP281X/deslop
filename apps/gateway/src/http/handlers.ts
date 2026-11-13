import {Effect, Option, Schema, String, pipe} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {Auth} from '@deslop/runtime/server/auth'
import {AuthError, COOKIE, signInUrl} from '@deslop/runtime/shared/auth'

import {AiProvider} from '#services/ai-proxy/schema.ts'
import {AiProxy} from '#services/ai-proxy/service.ts'
import {clientMetadata} from '#services/connections/lib/utils.ts'
import {Callback, ServerParams} from '#services/connections/schema.ts'
import {Connections, gatewayUrl} from '#services/connections/service.ts'
import {Gateway} from '#services/gateway/service.ts'

// A step's answer is never cached; a failure returns to the servers page, whose row shows why.
function returning<E, R>(step: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) {
	return pipe(
		step,
		Effect.orElseSucceed(() => HttpServerResponse.redirect('/')),
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
				})
			)
		)
		// A provider the gateway registered with answers at its server's own callback; one using the metadata document at the shared one.
		const callback = Effect.fnUntraced(function* (route: Option.Option<string>) {
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
			Effect.flatMap(HttpRouter.params, params => callback(Option.fromUndefinedOr(params['id'])))
		)
	})
)

export const AiHttpHandlers = HttpRouter.use(router =>
	Effect.gen(function* () {
		const ai = yield* AiProxy
		yield* router.add(
			'*',
			'/ai/:provider/*',
			Effect.gen(function* () {
				const params = yield* HttpRouter.params
				const provider = Schema.decodeUnknownOption(AiProvider)(params['provider'])
				if (provider._tag === 'None') {
					return HttpServerResponse.jsonUnsafe({error: {message: 'Unknown AI provider'}}, {status: 404})
				}
				return yield* ai.proxy(
					provider.value,
					String.slice(`/ai/${provider.value}/`.length)((yield* HttpServerRequest.HttpServerRequest).url)
				)
			})
		)
	})
)
