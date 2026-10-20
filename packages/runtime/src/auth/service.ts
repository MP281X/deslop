import {Array, Config, Context, Effect, Layer, Option, Result, Schema, pipe} from 'effect'

import {Headers, HttpClient, HttpClientResponse, HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {AUTH_URL, CurrentUser, RpcAuth} from '#auth/lib/utils.ts'
import {AuthError, Resource, User} from '#auth/schema.ts'

function rejected(message: string) {
	return Effect.mapError(cause => {
		if (Schema.is(AuthError)(cause)) return cause
		return AuthError.make({cause, message})
	})
}

export class Auth extends Context.Service<
	Auth,
	{
		readonly user: (headers: Headers.Headers) => Effect.Effect<User, AuthError>
		readonly access: (headers: Headers.Headers, resource: string) => Effect.Effect<User, AuthError>
	}
>()('@deslop/runtime/auth/service/Auth') {
	static readonly makeContext = (auth: typeof Auth.Service) =>
		pipe(
			Context.make(Auth, auth),
			Context.add(
				RpcAuth,
				RpcAuth.of((effect, request) =>
					pipe(
						auth.user(request.headers),
						Effect.flatMap(user => Effect.provideService(effect, CurrentUser, user))
					)
				)
			)
		)

	static readonly layer = (resource: string) =>
		Layer.effectContext(
			Effect.gen(function* () {
				const url = yield* pipe(Config.String('AUTH_URL'), Config.withDefault(AUTH_URL))
				const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
				const origins = [
					new URL(url).origin,
					'https://portfolio.mp281x.xyz',
					...Array.map(Resource.literals, identifier => new URL(identifier).origin)
				]
				const access = Effect.fn('Auth.access')(function* (headers: Headers.Headers, audience: string) {
					return yield* pipe(
						client.get(`${url}/auth/verify`, {
							headers: {authorization: headers['authorization'] ?? ''},
							urlParams: {resource: audience}
						}),
						Effect.flatMap(HttpClientResponse.schemaBodyJson(User)),
						Effect.timeout('10 seconds')
					)
				}, rejected('Sign in first'))
				return Auth.makeContext(
					Auth.of({
						access,
						user: Effect.fn('Auth.user')(function* (headers: Headers.Headers) {
							if (Option.isSome(Headers.get(headers, 'authorization'))) {
								return yield* access(headers, resource)
							}
							if (Option.exists(Headers.get(headers, 'origin'), origin => !Array.contains(origins, origin))) {
								return yield* AuthError.make({message: 'The request comes from another origin'})
							}
							return yield* pipe(
								client.get(`${url}/auth/session`, {headers: {cookie: headers['cookie'] ?? ''}}),
								Effect.flatMap(HttpClientResponse.schemaBodyJson(User)),
								Effect.timeout('10 seconds')
							)
						}, rejected('Sign in first'))
					})
				)
			})
		)
}

export const HttpAuth = HttpRouter.middleware<{provides: CurrentUser}>()(
	Effect.gen(function* () {
		const auth = yield* Auth
		return app =>
			Effect.gen(function* () {
				const user = yield* Effect.result(auth.user((yield* HttpServerRequest.HttpServerRequest).headers))
				if (Result.isFailure(user)) return HttpServerResponse.text('Sign in first', {status: 401})
				return yield* Effect.provideService(app, CurrentUser, user.success)
			})
	})
)

export function layerMcpAuth(resource: string) {
	return HttpRouter.middleware<{provides: CurrentUser}>()(
		Effect.gen(function* () {
			const auth = yield* Auth
			return app =>
				Effect.gen(function* () {
					const user = yield* Effect.result(auth.access((yield* HttpServerRequest.HttpServerRequest).headers, resource))
					if (Result.isFailure(user)) {
						return HttpServerResponse.text('Authorization required', {
							headers: {
								'www-authenticate': `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp', resource).href}", scope="deslop"`
							},
							status: 401
						})
					}
					return yield* Effect.provideService(app, CurrentUser, user.success)
				})
		})
	).layer
}
