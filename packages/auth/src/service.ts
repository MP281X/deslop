import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	Crypto,
	Duration,
	Effect,
	HashSet,
	Layer,
	Option,
	Redacted,
	Ref,
	Result,
	Schedule,
	Schema,
	String,
	pipe
} from 'effect'

import {Base64Url} from 'effect/encoding'
import {
	Cookies,
	Headers,
	HttpClient,
	HttpClientRequest,
	HttpClientResponse,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
	UrlParams,
	Url
} from 'effect/http'

import {
	AuthError,
	CallbackParams,
	GitHubUser,
	OAuthFlow,
	OAuthTokenError,
	OAuthTokenResponse,
	Session,
	SignInParams,
	Verification,
	User
} from '#schema.ts'

import {AUTH_URL, CurrentUser, RpcAuth, development} from '#lib/utils.ts'

const SESSION_COOKIE = '__Secure-session'
const OAUTH_COOKIE = '__Host-oauth'
const COOKIE = {httpOnly: true, path: '/', sameSite: 'lax', secure: true} as const
const SESSION_DURATION = Duration.days(365)
const OAUTH_DURATION = Duration.minutes(10)
const DEVELOPMENT_USER = User.make({id: 'development', name: 'Developer'})
const MOCK_AUTH = {
	verify: Effect.fn('Auth.verify')(function* (_token: string) {
		return yield* Effect.succeed(DEVELOPMENT_USER)
	})
}
// An Ed25519 private key in PKCS #8 is this header and the 32-byte seed.
const PKCS8_ED25519 = Uint8Array.from([
	0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20
])

// GitHub sign-in turns on once all three are set; GITHUB_USERS lists the GitHub ids let in, from `gh api user --jq .id`.
const github = Config.all({
	clientId: Config.String('GITHUB_CLIENT_ID'),
	clientSecret: Config.Redacted('GITHUB_CLIENT_SECRET'),
	users: Config.Array(Schema.Int, 'GITHUB_USERS')
})

function bytes(text: string) {
	return new TextEncoder().encode(text)
}

function rejected(message: string) {
	return Effect.mapError(cause => AuthError.make({cause, message}))
}

// A rejection answers 401, a failing dependency 500; the log keeps the cause.
function respond<E, R>(message: string, handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) {
	return Effect.catch(handler, cause =>
		Effect.as(
			Effect.logWarning(message, cause),
			HttpServerResponse.text(message, {
				status: Boolean.match(Schema.is(AuthError)(cause), {onFalse: () => 500, onTrue: () => 401})
			})
		)
	)
}

// A command line and a native app send the token as the bearer, a browser in the session cookie.
const userFrom = Effect.fnUntraced(function* (auth: typeof Auth.Service, headers: Headers.Headers) {
	if (yield* development) return DEVELOPMENT_USER
	return yield* pipe(
		Headers.get(headers, 'authorization'),
		Option.filter(String.startsWith('Bearer ')),
		Option.map(String.replace('Bearer ', '')),
		Option.orElse(() =>
			pipe(
				Headers.get(headers, 'cookie'),
				Option.flatMapNullishOr(cookie => Cookies.parseHeader(cookie)[SESSION_COOKIE])
			)
		),
		Effect.fromOption,
		rejected('Sign in first'),
		Effect.flatMap(token => auth.verify(token))
	)
})

function provide(auth: typeof Auth.Service) {
	return pipe(
		Context.make(Auth, auth),
		Context.add(
			RpcAuth,
			RpcAuth.of((effect, request) =>
				Effect.flatMap(userFrom(auth, request.headers), user => Effect.provideService(effect, CurrentUser, user))
			)
		)
	)
}

// A token is `<base64url Session JSON>.<base64url Ed25519 signature>`, checked against the current key and users.
function verifyWith(current: Effect.Effect<{publicKey: CryptoKey; users: HashSet.HashSet<string>}>) {
	return Effect.fn('Auth.verify')(function* (token: string) {
		const {publicKey, users} = yield* current
		const parts = String.split(token, '.')
		const signature = yield* pipe(
			Array.get(parts, 1),
			Option.flatMap(part => Result.getSuccess(Base64Url.decode(part))),
			Effect.fromOption
		)
		if (
			!(yield* Effect.tryPromise(() =>
				crypto.subtle.verify('Ed25519', publicKey, new Uint8Array(signature), bytes(Array.headNonEmpty(parts)))
			))
		) {
			return yield* AuthError.make({message: 'The session signature is invalid'})
		}
		const session = yield* Schema.decodeEffect(Session)(Array.headNonEmpty(parts))
		if (session.expiresAt <= (yield* Clock.currentTimeMillis)) {
			return yield* AuthError.make({message: 'The session expired'})
		}
		if (!HashSet.has(users, session.user.id)) {
			return yield* AuthError.make({message: `${session.user.id} is not on the allow list`})
		}
		return session.user
	}, rejected('Sign in first'))
}

// Browsers send Origin on every POST, cross-origin fetch and WebSocket upgrade; any other origin is cross-site request forgery.
const SameOrigin = HttpRouter.middleware(httpEffect =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest
		// Traefik forwards a WebSocket upgrade over TLS as `wss`, which `HttpServerRequest.toURL` reads as http.
		const scheme = Boolean.match(
			Option.exists(Headers.get(request.headers, 'x-forwarded-proto'), proto => proto === 'https' || proto === 'wss'),
			{onFalse: () => 'http', onTrue: () => 'https'}
		)
		if (
			Option.exists(
				Headers.get(request.headers, 'origin'),
				origin => origin !== `${scheme}://${request.headers['host'] ?? ''}`
			)
		) {
			return HttpServerResponse.text('The request comes from another origin', {status: 403})
		}
		return yield* httpEffect
	})
).layer

// auth.mp281x.xyz sets the session cookie on mp281x.xyz, so every app beside it reads it.
function parentDomain(request: HttpServerRequest.HttpServerRequest) {
	return pipe(
		HttpServerRequest.toURL(request),
		Option.map(url => pipe(url.hostname, String.split('.'), Array.drop(1), Array.join('.'))),
		Option.filter(String.isNonEmpty)
	)
}

// The callback URL follows the request's host; register https://<host>/auth/github/callback in the GitHub OAuth app.
function callbackUrl(request: HttpServerRequest.HttpServerRequest) {
	return pipe(
		HttpServerRequest.toURL(request),
		Option.map(url => new URL('/auth/github/callback', url).href),
		Effect.fromOption
	)
}

// OAuth with PKCE: a native app's sign-in ends on one of `redirects` with `?token=`, a web app's on its URL with the cookie.
const addGitHub = Effect.fnUntraced(function* (
	issuer: typeof Issuer.Service,
	config: Config.Success<typeof github>,
	redirects: string[]
) {
	const router = yield* HttpRouter.HttpRouter
	const random = yield* Crypto.Crypto
	const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)

	yield* router.add(
		'GET',
		'/auth/github',
		respond(
			'Cannot start the GitHub sign-in',
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				const query = yield* pipe(
					HttpServerRequest.schemaSearchParams(SignInParams),
					rejected('The redirect is invalid')
				)
				const domain = parentDomain(request)
				if (
					Option.exists(
						Option.fromUndefinedOr(query.redirect),
						redirect =>
							!Array.contains(redirects, redirect) &&
							!Option.exists(
								Result.getSuccess(Url.fromString(redirect)),
								url =>
									url.protocol === 'https:' &&
									Option.exists(domain, parent => String.endsWith(`.${parent}`)(`.${url.hostname}`))
							)
					)
				) {
					return yield* AuthError.make({message: 'The redirect is not allowed'})
				}
				const state = Base64Url.encode(yield* random.randomBytes(32))
				const verifier = Base64Url.encode(yield* random.randomBytes(32))
				const authorize = UrlParams.toString(
					UrlParams.fromInput({
						client_id: config.clientId,
						code_challenge: Base64Url.encode(yield* random.digest('SHA-256', bytes(verifier))),
						code_challenge_method: 'S256',
						redirect_uri: yield* callbackUrl(request),
						response_type: 'code',
						state
					})
				)
				return HttpServerResponse.setCookieUnsafe(
					HttpServerResponse.redirect(`https://github.com/login/oauth/authorize?${authorize}`),
					OAUTH_COOKIE,
					yield* Schema.encodeEffect(OAuthFlow)({...query, state, verifier}),
					{...COOKIE, maxAge: OAUTH_DURATION}
				)
			})
		)
	)

	yield* router.add(
		'GET',
		'/auth/github/callback',
		respond(
			'The GitHub sign-in failed',
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				const params = yield* pipe(
					HttpServerRequest.schemaSearchParams(CallbackParams),
					rejected('GitHub sent no code')
				)
				const flow = yield* pipe(
					Schema.decodeUnknownEffect(OAuthFlow)(request.cookies[OAUTH_COOKIE]),
					rejected('The sign-in expired')
				)
				if (flow.state !== params.state) {
					return yield* AuthError.make({message: 'The sign-in state does not match'})
				}
				const token = yield* pipe(
					HttpClientRequest.post('https://github.com/login/oauth/access_token'),
					HttpClientRequest.acceptJson,
					HttpClientRequest.bodyUrlParams({
						client_id: config.clientId,
						client_secret: Redacted.value(config.clientSecret),
						code: params.code,
						code_verifier: flow.verifier,
						grant_type: 'authorization_code',
						redirect_uri: yield* callbackUrl(request)
					}),
					exchange => client.execute(exchange),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(OAuthTokenResponse))
				)
				if (Schema.is(OAuthTokenError)(token)) {
					return yield* AuthError.make({message: `GitHub rejected the code: ${token.error}`})
				}
				const githubUser = yield* pipe(
					HttpClientRequest.get('https://api.github.com/user'),
					HttpClientRequest.bearerToken(token.access_token),
					HttpClientRequest.setHeaders({accept: 'application/vnd.github+json', 'user-agent': '@deslop/auth'}),
					lookup => client.execute(lookup),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubUser))
				)
				const session = yield* issuer.issue({id: `github:${githubUser.id}`, name: githubUser.login})
				const redirect = flow.redirect ?? '/'
				if (Array.contains(redirects, redirect)) {
					return HttpServerResponse.expireCookieUnsafe(
						HttpServerResponse.redirect(`${redirect}?${UrlParams.toString(UrlParams.fromInput({token: session}))}`),
						OAUTH_COOKIE,
						COOKIE
					)
				}
				return HttpServerResponse.setCookieUnsafe(
					HttpServerResponse.expireCookieUnsafe(HttpServerResponse.redirect(redirect), OAUTH_COOKIE, COOKIE),
					SESSION_COOKIE,
					session,
					{...COOKIE, domain: Option.getOrUndefined(parentDomain(request)), maxAge: SESSION_DURATION}
				)
			})
		)
	)
})

export class Auth extends Context.Service<Auth, {readonly verify: (token: string) => Effect.Effect<User, AuthError>}>()(
	'@deslop/auth/service/Auth'
) {
	// Every app beside the auth app: provides Auth and RpcAuth with the key and users read from AUTH_URL each minute.
	static readonly layer = Layer.merge(
		SameOrigin,
		Layer.effectContext(
			Effect.gen(function* () {
				if (yield* development) return provide(Auth.of(MOCK_AUTH))
				const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
				const url = yield* pipe(Config.String('AUTH_URL'), Config.withDefault(AUTH_URL))
				const read = pipe(
					client.get(`${url}/auth/keys`),
					Effect.flatMap(HttpClientResponse.schemaBodyJson(Verification)),
					Effect.flatMap(verification =>
						Effect.map(
							pipe(
								Effect.fromResult(Base64Url.decode(verification.key)),
								Effect.flatMap(key =>
									Effect.tryPromise(() =>
										crypto.subtle.importKey('raw', new Uint8Array(key), {name: 'Ed25519'}, false, ['verify'])
									)
								)
							),
							publicKey => ({publicKey, users: HashSet.fromIterable(verification.users)})
						)
					),
					Effect.timeout('10 seconds')
				)
				const current = yield* Ref.make(
					yield* pipe(
						read,
						Effect.tapError(cause => Effect.logWarning(`Cannot read the auth keys from ${url}`, cause)),
						Effect.retry(Schedule.spaced('5 seconds'))
					)
				)
				// An unreachable auth app keeps the last key and users until it answers again.
				yield* pipe(
					read,
					Effect.flatMap(verification => Ref.set(current, verification)),
					Effect.ignore({log: 'Warn', message: `Cannot refresh the auth keys from ${url}`}),
					Effect.repeat(Schedule.spaced('1 minute')),
					Effect.forkScoped
				)
				return provide(Auth.of({verify: verifyWith(Ref.get(current))}))
			})
		)
	)
}

export class Issuer extends Context.Service<
	Issuer,
	{readonly issue: (user: User) => Effect.Effect<string, AuthError>}
>()('@deslop/auth/service/Issuer') {
	// The auth app: an Ed25519 key from GITHUB_CLIENT_SECRET; `redirects` are native sign-in URLs, such as `stash://auth`.
	static readonly layer = (options: {redirects: string[]}) =>
		Layer.provideMerge(
			Layer.effectContext(
				Effect.gen(function* () {
					const router = yield* HttpRouter.HttpRouter
					if (yield* development) {
						yield* router.add('POST', '/auth/sign-out', HttpServerResponse.redirect('/', {status: 303}))
						return Context.add(
							provide(Auth.of(MOCK_AUTH)),
							Issuer,
							Issuer.of({
								issue: Effect.fn('Issuer.issue')(function* (_user: User) {
									return yield* Effect.succeed('development')
								})
							})
						)
					}
					const random = yield* Crypto.Crypto
					const provider = yield* Config.option(github)
					const users = HashSet.fromIterable(
						Option.match(provider, {
							onNone: Array.empty<string>,
							onSome: config => Array.map(config.users, id => `github:${id}`)
						})
					)
					// Without a provider nobody signs in, so the key needs no secret.
					const seed = yield* Option.match(provider, {
						onNone: () => random.randomBytes(32),
						onSome: config =>
							random.digest('SHA-256', bytes(`@deslop/auth session ${Redacted.value(config.clientSecret)}`))
					})
					const privateKey = yield* Effect.tryPromise(() =>
						crypto.subtle.importKey(
							'pkcs8',
							new Uint8Array([...PKCS8_ED25519, ...new Uint8Array(seed)]),
							{name: 'Ed25519'},
							true,
							['sign']
						)
					)
					// The JWK of an Ed25519 key holds its public key as `x`, base64url.
					const publicJwk = yield* pipe(
						Effect.tryPromise(() => crypto.subtle.exportKey('jwk', privateKey)),
						Effect.flatMap(jwk => Effect.fromOption(Option.fromUndefinedOr(jwk.x))),
						Effect.map(x => ({crv: 'Ed25519', kty: 'OKP', x}))
					)
					const publicKey = yield* Effect.tryPromise(() =>
						crypto.subtle.importKey('jwk', publicJwk, {name: 'Ed25519'}, false, ['verify'])
					)

					const issue = Effect.fn('Issuer.issue')(function* (user: User) {
						if (!HashSet.has(users, user.id)) {
							return yield* AuthError.make({message: `${user.id} is not on the allow list`})
						}
						const payload = yield* Schema.encodeEffect(Session)({
							expiresAt: (yield* Clock.currentTimeMillis) + Duration.toMillis(SESSION_DURATION),
							user
						})
						return `${payload}.${Base64Url.encode(new Uint8Array(yield* Effect.tryPromise(() => crypto.subtle.sign('Ed25519', privateKey, bytes(payload)))))}`
					}, rejected('Cannot sign in'))

					const issuer = Issuer.of({issue})

					yield* router.add(
						'GET',
						'/auth/keys',
						HttpServerResponse.schemaJson(Verification)({key: publicJwk.x, users: Array.fromIterable(users)})
					)
					yield* router.add(
						'POST',
						'/auth/sign-out',
						Effect.map(HttpServerRequest.HttpServerRequest, request =>
							HttpServerResponse.expireCookieUnsafe(HttpServerResponse.redirect('/', {status: 303}), SESSION_COOKIE, {
								...COOKIE,
								domain: Option.getOrUndefined(parentDomain(request))
							})
						)
					)
					yield* Option.match(provider, {
						onNone: () => Effect.void,
						onSome: config => addGitHub(issuer, config, options.redirects)
					})

					return Context.add(provide(Auth.of({verify: verifyWith(Effect.succeed({publicKey, users}))})), Issuer, issuer)
				})
			),
			SameOrigin
		)
}

export const HttpAuth = HttpRouter.middleware<{provides: CurrentUser}>()(
	Effect.gen(function* () {
		const auth = yield* Auth
		return httpEffect =>
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				const user = yield* Effect.result(userFrom(auth, request.headers))
				if (Result.isFailure(user)) {
					if (String.includes('text/html')(request.headers['accept'] ?? '')) {
						return HttpServerResponse.redirect(
							`${AUTH_URL}/auth/github?${UrlParams.toString(UrlParams.fromInput({redirect: Option.match(HttpServerRequest.toURL(request), {onNone: () => '/', onSome: url => url.href})}))}`
						)
					}
					return yield* Effect.as(
						Effect.logWarning('Sign in first', user.failure),
						HttpServerResponse.text('Sign in first', {status: 401})
					)
				}
				return yield* Effect.provideService(httpEffect, CurrentUser, user.success)
			})
	})
)
