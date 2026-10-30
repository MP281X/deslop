import {NodeCrypto} from '@effect/platform-node'

import {Array, Config, Context, Effect, Layer, Option, Result, Schema, pipe} from 'effect'

import {
	Headers,
	HttpClient,
	HttpClientError,
	HttpClientResponse,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse
} from 'effect/http'

import {previewAuth} from '#auth/lib/preview.ts'
import {AUTH_URL, CurrentUser, RpcAuth} from '#auth/lib/utils.ts'
import {AuthError, Resource, User} from '#auth/schema.ts'

function rejected(message: string) {
	return Effect.mapError(cause => {
		if (Schema.is(AuthError)(cause)) return cause
		if (
			HttpClientError.isHttpClientError(cause) &&
			cause.reason._tag === 'StatusCodeError' &&
			cause.reason.response.status === 401
		) {
			return AuthError.make({cause, message})
		}
		return AuthError.make({
			cause,
			error: 'temporarily_unavailable',
			message: 'The authorization service is temporarily unavailable'
		})
	})
}

const unavailable = HttpServerResponse.text('The authorization service is temporarily unavailable; retry later', {
	headers: {'retry-after': '5'},
	status: 503
})

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
						Effect.flatMap(user =>
							Effect.raceFirst(
								Effect.provideService(effect, CurrentUser, user),
								// A watch outlives its token, so it ends once the credentials expire or are revoked; an auth restart does not end it.
								pipe(
									Effect.delay(auth.user(request.headers), '5 minutes'),
									Effect.retry({while: error => error.error === 'temporarily_unavailable'}),
									Effect.forever
								)
							)
						)
					)
				)
			)
		)

	static readonly layer = (resource: string) =>
		pipe(
			Layer.effectContext(
				Effect.gen(function* () {
					// Where this server reaches the auth app: inside the deploy, its container address.
					const url = yield* pipe(Config.String('AUTH_URL'), Config.withDefault(AUTH_URL))
					const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
					const preview = yield* previewAuth(resource, url, client)
					const origins = [
						AUTH_URL,
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
								const bearer = yield* preview(headers)
								if (Option.isSome(bearer)) {
									return yield* access(
										Headers.set(headers, 'authorization', `Bearer ${Option.getOrThrow(bearer)}`),
										resource
									)
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
			),
			Layer.provide(Layer.mergeAll(NodeCrypto.layerSecureRandom, NodeCrypto.layerDigest))
		)
}

export const HttpAuth = HttpRouter.middleware<{provides: CurrentUser}>()(
	Effect.gen(function* () {
		const auth = yield* Auth
		return app =>
			Effect.gen(function* () {
				const user = yield* Effect.result(auth.user((yield* HttpServerRequest.HttpServerRequest).headers))
				if (Result.isFailure(user)) {
					if (user.failure.error === 'temporarily_unavailable') return unavailable
					return HttpServerResponse.text('Sign in first', {status: 401})
				}
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
					const headers = (yield* HttpServerRequest.HttpServerRequest).headers
					const challenge = `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource/mcp', resource).href}", scope="deslop"`
					if (Option.isNone(Headers.get(headers, 'authorization'))) {
						return HttpServerResponse.text('OAuth authorization required; sign in with your MCP client', {
							headers: {'www-authenticate': challenge},
							status: 401
						})
					}
					const user = yield* Effect.result(auth.access(headers, resource))
					if (Result.isFailure(user)) {
						if (user.failure.error === 'temporarily_unavailable') return unavailable
						return HttpServerResponse.text(
							'The access token is invalid or expired; your MCP client refreshes it, and asks you to sign in again only if refreshing fails',
							{headers: {'www-authenticate': `${challenge}, error="invalid_token"`}, status: 401}
						)
					}
					return yield* Effect.provideService(app, CurrentUser, user.success)
				})
		})
	).layer
}
