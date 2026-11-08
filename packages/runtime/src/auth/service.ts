import {Config, Context, Effect, Layer, Option, Result, Schema, pipe} from 'effect'

import {
	Headers,
	HttpClient,
	HttpClientError,
	HttpClientResponse,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse
} from 'effect/http'
import {RpcSchema} from 'effect/rpc'

import {MCP_METADATA_PATH} from '#schema.ts'

import {AiGateway} from '#ai/service.ts'
import {CurrentUser, DEVELOPER, RpcAuth, SESSION_PATH, VERIFY_PATH, localAuth} from '#auth/lib/utils.ts'
import {AuthError, User} from '#auth/schema.ts'

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

function developer() {
	return Effect.succeed(DEVELOPER)
}

function enrolled(user: User, headers: Headers.Headers) {
	return Effect.gen(function* () {
		const gateway = Context.getOrUndefined(yield* Effect.context<never>(), AiGateway)
		if (gateway) yield* gateway.enroll(user.id, headers)
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
						Effect.tap(user => enrolled(user, request.headers)),
						Effect.tap(() => {
							if (RpcSchema.isStreamSchema(request.rpc.successSchema)) {
								return Effect.annotateCurrentSpan('rpc.stream', true)
							}
							return Effect.void
						}),
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

	// Signed-in requests verify with the issuer: a bearer for this app's canonical origin, else the shared session cookie.
	static readonly layer = Layer.effectContext(
		Effect.gen(function* () {
			if (yield* localAuth) return Auth.makeContext(Auth.of({access: developer, user: developer}))
			const issuer = yield* Config.String('AUTH_URL')
			const canonical = new URL(yield* Config.String('APP_URL')).origin
			const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
			const access = Effect.fn('Auth.access')(function* (headers: Headers.Headers, audience: string) {
				return yield* pipe(
					client.get(new URL(VERIFY_PATH, issuer).href, {
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
						if (Option.isSome(Headers.get(headers, 'authorization'))) return yield* access(headers, canonical)
						return yield* pipe(
							client.get(new URL(SESSION_PATH, issuer).href, {headers: {cookie: headers['cookie'] ?? ''}}),
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
				if (Result.isFailure(user)) {
					if (user.failure.error === 'temporarily_unavailable') return unavailable
					return HttpServerResponse.text('Sign in first', {status: 401})
				}
				yield* enrolled(user.success, (yield* HttpServerRequest.HttpServerRequest).headers)
				return yield* Effect.provideService(app, CurrentUser, user.success)
			})
	})
)

export function layerMcpAuth(resource: string) {
	return HttpRouter.middleware<{provides: CurrentUser}>()(
		Effect.gen(function* () {
			const auth = yield* Auth
			// Without an issuer the MCP endpoint answers without OAuth, as its pages do.
			if (yield* localAuth) return app => Effect.provideService(app, CurrentUser, DEVELOPER)
			return app =>
				Effect.gen(function* () {
					const headers = (yield* HttpServerRequest.HttpServerRequest).headers
					const challenge = `Bearer resource_metadata="${new URL(MCP_METADATA_PATH, resource).href}", scope="deslop"`
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
					yield* enrolled(user.success, headers)
					return yield* Effect.provideService(app, CurrentUser, user.success)
				})
		})
	).layer
}
