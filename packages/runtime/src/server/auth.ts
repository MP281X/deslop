import {Cache, Config, Context, Effect, Exit, Function, Layer, Option, Result, Schema, pipe} from 'effect'

import {
	Cookies,
	Headers,
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
	HttpMiddleware,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse
} from 'effect/http'
import {NetAddress} from 'effect/net'

import {
	AuthError,
	CLIENT_HEADER,
	CurrentUser,
	DEVELOPER,
	GitHubId,
	GitHubIdFromString,
	IDENTIFY_PATH,
	IdentifyRequest,
	ON_BEHALF_HEADER,
	RpcAuth,
	SESSION_COOKIE,
	UserId,
	asAuthError,
	failureOptions,
	isAdmin
} from '#shared/auth.ts'
import type {User} from '#shared/auth.ts'
import {Account} from '#shared/schema.ts'

// Without an issuer (`--auth`) there is no sign-in: every request is this trusted developer.
export const localAuth = Config.map(Config.option(Config.String('AUTH_URL')), Option.isNone)

// Admins come from GITHUB_ADMINS; a local install with no issuer falls back to the developer account when none are named.
export const adminIds = Effect.gen(function* () {
	const listed = Config.Array(GitHubIdFromString, 'GITHUB_ADMINS')
	if (yield* localAuth) return yield* Config.withDefault(listed, [GitHubId.make(0)])
	return yield* listed
})

export function requireAdmin(admins: readonly GitHubId[], user: User, message: string) {
	if (isAdmin(admins, user.id)) return Effect.void
	return Effect.fail(AuthError.make({error: 'access_denied', message}))
}

// What a request carries for Auth: the address the runtime derived, the shared browser cookie and an app's on-behalf claim.
export function identifyRequestOf(headers: Headers.Headers) {
	return IdentifyRequest.make({
		address: Option.fromNullishOr(headers[CLIENT_HEADER]),
		onBehalfOf: Option.flatMap(Option.fromNullishOr(headers[ON_BEHALF_HEADER]), Schema.decodeOption(UserId)),
		session: Option.fromNullishOr(Cookies.parseHeader(headers['cookie'] ?? '')[SESSION_COOKIE])
	})
}

// The proxy in front of every app runs on its machine, so only a loopback peer's X-Forwarded-For is read; a request without one names no client.
export const clientAddress = HttpMiddleware.make(app =>
	HttpMiddleware.xForwardedHeaders({trustedProxies: NetAddress.isLoopback})(
		Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest
			const unclaimed = Headers.remove(request.headers, CLIENT_HEADER)
			const headers = pipe(
				request.remoteAddress,
				Option.filter(address => !Option.exists(Result.getSuccess(NetAddress.ipFromString(address)), NetAddress.isLoopback)),
				Option.match({
					onNone: () => unclaimed,
					onSome: address => Headers.set(unclaimed, CLIENT_HEADER, address)
				})
			)
			return yield* Effect.provideService(app, HttpServerRequest.HttpServerRequest, request.modify({headers}))
		})
	)
)

function refusalOf(status: number, message: string) {
	if (status === 403) return AuthError.make({error: 'access_denied', message})
	return AuthError.make({message})
}

export class Auth extends Context.Service<
	Auth,
	{
		readonly account: (headers: Headers.Headers) => Effect.Effect<Account, AuthError>
		readonly user: (headers: Headers.Headers) => Effect.Effect<User, AuthError>
	}
>()('@deslop/runtime/server/auth') {
	// A socket stays its person's only while Auth keeps naming them, checked again every five minutes.
	static readonly makeContext = (account: (headers: Headers.Headers) => Effect.Effect<Account, AuthError>) => {
		const user = Effect.fn('Auth.user')(function* (headers: Headers.Headers) {
			const found = yield* account(headers)
			return {id: found.id, name: found.name}
		})
		return Context.add(
			Context.make(Auth, Auth.of({account, user})),
			RpcAuth,
			RpcAuth.of((effect, request) =>
				Effect.flatMap(user(request.headers), found =>
					pipe(
						effect,
						Effect.provideService(CurrentUser, found),
						Effect.raceFirst(
							pipe(
								Effect.delay(user(request.headers), '5 minutes'),
								Effect.retry({while: error => error.error === 'temporarily_unavailable'}),
								Effect.forever
							)
						)
					)
				)
			)
		)
	}

	// Auth names every caller; its answer is kept half a minute so a page's requests ask once.
	static readonly layer = Layer.unwrap(
		Effect.gen(function* () {
			if (yield* localAuth) {
				return Layer.succeedContext(
					Auth.makeContext(() => Effect.withSpan(Effect.succeed({...DEVELOPER, signOut: false}), 'Auth.account'))
				)
			}
			return Layer.effectContext(
				Effect.gen(function* () {
					const issuer = yield* Config.String('AUTH_URL')
					const client = yield* HttpClient.HttpClient
					const answers = yield* Cache.makeWith(
						Effect.fnUntraced(function* (body: string) {
							const response = yield* pipe(
								HttpClientRequest.post(new URL(IDENTIFY_PATH, issuer).href),
								HttpClientRequest.bodyText(body, 'application/json'),
								client.execute,
								Effect.timeout('10 seconds')
							)
							if (response.status === 401 || response.status === 403) {
								return yield* refusalOf(
									response.status,
									Option.getOrElse(yield* Effect.option(response.text), Function.constant('Sign in first'))
								)
							}
							return yield* HttpClientResponse.schemaBodyJson(Account)(yield* HttpClientResponse.filterStatusOk(response))
						}, asAuthError('The authorization service is temporarily unavailable')),
						// A refusal is asked again at once, so a sign-in shows on the next request.
						{capacity: 1024, timeToLive: Exit.match({onFailure: Function.constant(0), onSuccess: Function.constant('30 seconds')})}
					)
					return Auth.makeContext(
						Effect.fn('Auth.account')(function* (headers: Headers.Headers) {
							return yield* Cache.get(
								answers,
								yield* Schema.encodeEffect(Schema.fromJsonString(IdentifyRequest))(identifyRequestOf(headers))
							)
						}, asAuthError('The request could not be read'))
					)
				})
			)
		})
	)
}

const unavailable = HttpServerResponse.text('The authorization service is temporarily unavailable; retry later', {
	headers: {'retry-after': '5'},
	status: 503
})

export const HttpAuth = HttpRouter.middleware<{provides: CurrentUser}>()(
	Effect.gen(function* () {
		const auth = yield* Auth
		return app =>
			Effect.gen(function* () {
				const user = yield* Effect.result(auth.user((yield* HttpServerRequest.HttpServerRequest).headers))
				if (Result.isFailure(user)) {
					if (user.failure.error === 'temporarily_unavailable') return unavailable
					return HttpServerResponse.text(user.failure.message, failureOptions(user.failure, 401))
				}
				return yield* Effect.provideService(app, CurrentUser, user.success)
			})
	})
)
