import {Array, Duration, Effect, Match, Option, Schema, String, pipe} from 'effect'

import {Headers, HttpRouter, HttpServerRequest, HttpServerResponse, UrlParams} from 'effect/http'
import {RateLimiter} from 'effect/persistence'

import {AuthError, User} from '@deslop/runtime/auth/schema'
import {Auth} from '@deslop/runtime/auth/service'
import {AUTH_URL} from '@deslop/runtime/auth/utils'

import {Callback, ServerParams} from '#services/connections/schema.ts'
import {CLIENT, Connections} from '#services/connections/service.ts'
import {CallbackParams, LoginState, SignInParams} from '#services/github/schema.ts'
import {GitHub} from '#services/github/service.ts'
import {People} from '#services/people/service.ts'
import {typedCode} from '#services/sign-ins/lib/utils.ts'
import {BrowserParams, RequestParams} from '#services/sign-ins/schema.ts'
import {REQUEST_COOKIE, SignIns} from '#services/sign-ins/service.ts'
import {
	addressGroup,
	allowedRedirect,
	callbackUrl,
	clientIdOf,
	clientRequest,
	cookieDomain,
	returnable
} from '#services/tokens/lib/utils.ts'
import {
	AuthorizeClient,
	AuthorizeParams,
	Registration,
	RevokeParams,
	TokenGrant,
	TokenParams,
	VerificationParams
} from '#services/tokens/schema.ts'
import {SESSION_COOKIE, Tokens} from '#services/tokens/service.ts'

const COOKIE = {httpOnly: true, path: '/', sameSite: 'lax', secure: true} as const
const LOGIN_COOKIE = '__Host-login'
const ISSUER = `${AUTH_URL}/api/auth`

// The shared session reaches every app on the parent domain, for as long as its grant lasts.
function session(seconds: number) {
	return {...COOKIE, domain: cookieDomain(AUTH_URL), maxAge: `${seconds} seconds` as const}
}

function rejected(message: string) {
	return Effect.mapError(cause => {
		if (Schema.is(AuthError)(cause)) return cause
		return AuthError.make({cause, message})
	})
}

// OAuth endpoints answer failures as RFC 6749 JSON and are never cached.
function oauth<E, R>(handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) {
	return pipe(
		handler,
		Effect.catchIf(Schema.is(AuthError), failure =>
			Effect.succeed(
				HttpServerResponse.jsonUnsafe(
					{error: failure.error ?? 'invalid_request', error_description: failure.message},
					{status: 400}
				)
			)
		),
		Effect.map(HttpServerResponse.setHeader('cache-control', 'no-store'))
	)
}

// The address the client connects from: Traefik appends it as the last X-Forwarded-For entry, earlier ones are the client's word.
function clientAddress(request: HttpServerRequest.HttpServerRequest) {
	return pipe(
		Headers.get(request.headers, 'x-forwarded-for'),
		Option.flatMap(forwarded => Array.last(String.split(',')(forwarded))),
		Option.map(String.trim),
		Option.filter(String.isNonEmpty),
		Option.orElse(() => request.remoteAddress)
	)
}

// Where a request comes from, as the signed-in list names it.
function originOf(request: HttpServerRequest.HttpServerRequest) {
	return {
		...Option.match(clientAddress(request), {onNone: () => ({}), onSome: address => ({address})}),
		...Option.match(Headers.get(request.headers, 'user-agent'), {
			onNone: () => ({}),
			onSome: agent => ({userAgent: String.slice(0, 200)(agent)})
		})
	}
}

// A started sign-in shows its code at /?request=; the cookie binds its answer to this browser or command.
function waitingAt(started: {code: string; receiver: string}) {
	return HttpServerResponse.setCookieUnsafe(
		HttpServerResponse.redirect(`/?request=${started.code}`),
		`${REQUEST_COOKIE}${started.code}`,
		started.receiver,
		{...COOKIE, maxAge: '11 minutes'}
	)
}

// A cancelled or failed GitHub step returns to the waiting sign-in, so the page can start it again.
function githubFailed(cause: unknown, flow: Option.Option<SignInParams>) {
	return Effect.as(
		Effect.logWarning('GitHub sign-in failed', cause),
		HttpServerResponse.expireCookieUnsafe(
			HttpServerResponse.redirect(
				`/?${UrlParams.toString(
					UrlParams.fromInput({
						error: 'github',
						...Option.match(flow, {onNone: () => ({}), onSome: found => ({code: found.code, request: found.request})})
					})
				)}`
			),
			LOGIN_COOKIE,
			COOKIE
		)
	)
}

// Where a finished sign-in returns: the waiting sign-in or approve link it started from, else its page on this domain.
function returnTo(flow: SignInParams) {
	return pipe(
		UrlParams.toString(UrlParams.fromInput({code: flow.code, request: flow.request})),
		Option.liftPredicate(String.isNonEmpty),
		Option.match({
			onNone: () =>
				pipe(
					Option.fromUndefinedOr(flow.next),
					Option.filter(next => returnable(next, AUTH_URL)),
					Option.getOrElse(() => '/')
				),
			onSome: search => `/?${search}`
		})
	)
}

export const HttpHandlers = HttpRouter.use(router =>
	Effect.gen(function* () {
		const auth = yield* Auth
		const connections = yield* Connections
		const github = yield* GitHub
		const people = yield* People
		const signIns = yield* SignIns
		const tokens = yield* Tokens
		const limiter = yield* RateLimiter.RateLimiter
		// Anyone may call these, so each address (an IPv6 /64) and everyone together get a budget per minute; past it, 429.
		function limited(route: string, perAddress: number) {
			return Effect.fnUntraced(function* <E, R>(handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) {
				const address = pipe(
					clientAddress(yield* HttpServerRequest.HttpServerRequest),
					Option.map(addressGroup),
					Option.getOrElse(() => 'unknown')
				)
				return yield* pipe(
					limiter.consume({key: `${route}:${address}`, limit: perAddress, onExceeded: 'fail', window: '1 minute'}),
					Effect.andThen(limiter.consume({key: route, limit: perAddress * 20, onExceeded: 'fail', window: '1 minute'})),
					Effect.matchEffect({
						onFailure: failure =>
							Effect.succeed(
								HttpServerResponse.text('Too many requests; retry later', {
									headers: {
										'retry-after': Match.valueTags(failure.reason, {
											RateLimitExceeded: exceeded => `${Math.ceil(Duration.toSeconds(exceeded.retryAfter))}`,
											RateLimitStoreError: () => '5'
										})
									},
									status: 429
								})
							),
						onSuccess: () => handler
					})
				)
			})
		}

		yield* router.add(
			'GET',
			'/.well-known/oauth-authorization-server/api/auth',
			HttpServerResponse.jsonUnsafe({
				authorization_endpoint: `${ISSUER}/oauth2/authorize`,
				authorization_response_iss_parameter_supported: true,
				code_challenge_methods_supported: ['S256'],
				grant_types_supported: ['authorization_code', 'refresh_token'],
				issuer: ISSUER,
				registration_endpoint: `${ISSUER}/oauth2/register`,
				response_types_supported: ['code'],
				revocation_endpoint: `${ISSUER}/oauth2/revoke`,
				scopes_supported: ['deslop', 'offline_access'],
				token_endpoint: `${ISSUER}/oauth2/token`,
				token_endpoint_auth_methods_supported: ['none']
			})
		)
		yield* router.add(
			'POST',
			'/api/auth/oauth2/register',
			limited(
				'register',
				10
			)(
				oauth(
					Effect.gen(function* () {
						const params = yield* pipe(
							HttpServerRequest.schemaBodyJson(Registration),
							Effect.mapError(cause =>
								AuthError.make({
									cause,
									error: 'invalid_client_metadata',
									message: 'Send up to 4 redirect_uris of at most 200 characters and a client_name of at most 100'
								})
							)
						)
						if (!Array.every(params.redirect_uris, allowedRedirect)) {
							return yield* AuthError.make({
								error: 'invalid_redirect_uri',
								message: 'Use a loopback http://127.0.0.1 callback or a Stash, opm or Trips app callback'
							})
						}
						const name = params.client_name ?? 'Unknown client'
						return HttpServerResponse.jsonUnsafe(
							{
								client_id: clientIdOf({name, redirects: params.redirect_uris}),
								client_name: name,
								grant_types: ['authorization_code', 'refresh_token'],
								redirect_uris: params.redirect_uris,
								response_types: ['code'],
								token_endpoint_auth_method: 'none'
							},
							{status: 201}
						)
					})
				)
			)
		)
		// An app's sign-in becomes a waiting sign-in under a fresh code, answered by an approval and delivered at /auth/continue.
		yield* router.add(
			'GET',
			'/api/auth/oauth2/authorize',
			limited(
				'authorize',
				20
			)(
				oauth(
					Effect.gen(function* () {
						const request = yield* HttpServerRequest.HttpServerRequest
						// Until the client and its callback check out, an error stays on this page: RFC 9700 §4.11 forbids redirecting it.
						const asked = yield* pipe(
							HttpServerRequest.schemaSearchParams(AuthorizeClient),
							rejected('The authorization request names no client_id')
						)
						const client = yield* tokens.client(asked)
						return yield* pipe(
							HttpServerRequest.schemaSearchParams(AuthorizeParams),
							rejected('Invalid authorization request'),
							Effect.flatMap(params => clientRequest(asked, client, params)),
							Effect.flatMap(checked => signIns.start({_tag: 'Client', request: checked}, originOf(request))),
							Effect.map(waitingAt),
							Effect.catchIf(Schema.is(AuthError), failure =>
								Effect.succeed(
									HttpServerResponse.redirect(
										callbackUrl(
											{redirectUri: client.redirectUri, state: asked.state},
											{error: failure.error ?? 'invalid_request', error_description: failure.message}
										)
									)
								)
							)
						)
					})
				)
			)
		)
		yield* router.add(
			'POST',
			'/api/auth/oauth2/token',
			limited(
				'token',
				60
			)(
				oauth(
					Effect.gen(function* () {
						const grant = yield* pipe(HttpServerRequest.schemaBodyUrlParams(TokenGrant), rejected('Send a grant_type'))
						if (grant.grant_type !== 'authorization_code' && grant.grant_type !== 'refresh_token') {
							return yield* AuthError.make({
								error: 'unsupported_grant_type',
								message: 'Use grant_type authorization_code or refresh_token'
							})
						}
						return Match.valueTags(
							yield* tokens.exchange(
								yield* pipe(HttpServerRequest.schemaBodyUrlParams(TokenParams), rejected('Invalid token request')),
								originOf(yield* HttpServerRequest.HttpServerRequest),
								people.allowed
							),
							{
								Granted: granted => HttpServerResponse.jsonUnsafe(granted.tokens),
								// A replayed grant still revoked its family, so it answers instead of failing.
								Replayed: replayed =>
									HttpServerResponse.jsonUnsafe(
										{error: 'invalid_grant', error_description: replayed.message},
										{status: 400}
									)
							}
						)
					})
				)
			)
		)
		yield* router.add(
			'POST',
			'/api/auth/oauth2/revoke',
			oauth(
				Effect.gen(function* () {
					yield* tokens.revoke(
						yield* pipe(HttpServerRequest.schemaBodyUrlParams(RevokeParams), rejected('Invalid revocation request'))
					)
					return HttpServerResponse.empty()
				})
			)
		)
		// Apps read the session cookie and verify bearers here, through `Auth.layer`.
		yield* router.add(
			'GET',
			'/auth/session',
			pipe(
				Effect.flatMap(HttpServerRequest.HttpServerRequest, request => auth.user(request.headers)),
				Effect.flatMap(user => HttpServerResponse.schemaJson(User)(user, {headers: {'cache-control': 'no-store'}})),
				Effect.orElseSucceed(() => HttpServerResponse.empty({status: 401}))
			)
		)
		yield* router.add(
			'GET',
			'/auth/verify',
			pipe(
				Effect.gen(function* () {
					const params = yield* HttpServerRequest.schemaSearchParams(VerificationParams)
					return yield* auth.access((yield* HttpServerRequest.HttpServerRequest).headers, params.resource)
				}),
				Effect.flatMap(user => HttpServerResponse.schemaJson(User)(user, {headers: {'cache-control': 'no-store'}})),
				Effect.orElseSucceed(() => HttpServerResponse.empty({status: 401}))
			)
		)
		yield* router.add(
			'GET',
			'/auth/github',
			limited(
				'github',
				10
			)(
				oauth(
					Effect.gen(function* () {
						const started = yield* github.start(
							yield* pipe(HttpServerRequest.schemaSearchParams(SignInParams), rejected('Invalid sign-in request'))
						)
						return HttpServerResponse.setCookieUnsafe(
							HttpServerResponse.redirect(started.url),
							LOGIN_COOKIE,
							started.state,
							{...COOKIE, maxAge: '10 minutes'}
						)
					})
				)
			)
		)
		yield* router.add(
			'GET',
			'/auth/github/callback',
			pipe(
				Effect.gen(function* () {
					const params = yield* pipe(
						HttpServerRequest.schemaSearchParams(CallbackParams),
						rejected('GitHub sent no code')
					)
					if ((yield* HttpServerRequest.HttpServerRequest).cookies[LOGIN_COOKIE] !== params.state) {
						return yield* AuthError.make({message: 'The sign-in state does not match'})
					}
					const request = yield* HttpServerRequest.HttpServerRequest
					const finished = yield* github.finish(params.code, params.state)
					return yield* pipe(
						people.register(finished.profile),
						Effect.flatMap(user => tokens.startSession(user, originOf(request), 'GitHub')),
						Effect.map(started =>
							pipe(
								HttpServerResponse.redirect(returnTo(finished.flow)),
								HttpServerResponse.expireCookieUnsafe(LOGIN_COOKIE, COOKIE),
								HttpServerResponse.setCookieUnsafe(SESSION_COOKIE, started.token, session(started.seconds))
							)
						),
						Effect.catch(cause => githubFailed(cause, Option.some(finished.flow)))
					)
				}),
				// A cancelled GitHub step sends no code, only the state of the sign-in it belonged to.
				Effect.catch(cause =>
					Effect.flatMap(
						Effect.option(
							Effect.flatMap(HttpServerRequest.schemaSearchParams(LoginState), found => github.cancel(found.state))
						),
						flow => githubFailed(cause, flow)
					)
				)
			)
		)
		// A browser signs in with a code another signed-in browser, phone or agent approves, then returns to the page it came from.
		yield* router.add(
			'GET',
			'/auth/code',
			limited(
				'code',
				20
			)(
				oauth(
					Effect.gen(function* () {
						const next = (yield* pipe(
							HttpServerRequest.schemaSearchParams(BrowserParams),
							rejected('Invalid sign-in request')
						)).next
						return waitingAt(
							yield* signIns.start(
								{
									_tag: 'Browser',
									...pipe(
										Option.fromUndefinedOr(next),
										Option.filter(page => returnable(page, AUTH_URL)),
										Option.match({onNone: () => ({}), onSome: page => ({next: page})})
									)
								},
								originOf(yield* HttpServerRequest.HttpServerRequest)
							)
						)
					})
				)
			)
		)
		// Delivers an answered sign-in to the browser or command holding its cookie; a command repeats it on 408 until it is answered.
		yield* router.add(
			'GET',
			'/auth/continue',
			pipe(
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					const params = yield* pipe(HttpServerRequest.schemaSearchParams(RequestParams), rejected('Name the sign-in'))
					const collected = yield* signIns.collect(params.request, request.headers)
					const cookie = `${REQUEST_COOKIE}${typedCode(params.request)}`
					return Match.valueTags(collected, {
						Redirect: found =>
							HttpServerResponse.expireCookieUnsafe(HttpServerResponse.redirect(found.url), cookie, COOKIE),
						Session: found =>
							pipe(
								HttpServerResponse.redirect(found.next ?? '/'),
								HttpServerResponse.expireCookieUnsafe(cookie, COOKIE),
								HttpServerResponse.setCookieUnsafe(SESSION_COOKIE, found.token, session(found.seconds))
							),
						Waiting: () =>
							HttpServerResponse.text('Waiting for approval; repeat this request', {
								headers: {'retry-after': '1'},
								status: 408
							})
					})
				}),
				rejected('Cannot complete the sign-in'),
				Effect.catch(failure => Effect.succeed(HttpServerResponse.text(failure.message, {status: 400}))),
				Effect.map(HttpServerResponse.setHeader('cache-control', 'no-store'))
			)
		)
		yield* router.add(
			'POST',
			'/auth/sign-out',
			oauth(
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					if (request.headers['origin'] !== AUTH_URL) {
						return yield* AuthError.make({error: 'access_denied', message: 'The request comes from another origin'})
					}
					yield* tokens.endSession(request.headers)
					return HttpServerResponse.expireCookieUnsafe(HttpServerResponse.empty(), SESSION_COOKIE, {
						...COOKIE,
						domain: cookieDomain(AUTH_URL)
					})
				})
			)
		)
		yield* router.add('GET', '/auth/mcp/client.json', HttpServerResponse.jsonUnsafe(CLIENT))
		// Connecting a provider returns to the MCP page, whose row shows why a step failed.
		yield* router.add(
			'GET',
			'/auth/mcp/connect',
			pipe(
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					const params = yield* HttpServerRequest.schemaSearchParams(ServerParams)
					return yield* Option.match(yield* Effect.option(auth.user(request.headers)), {
						onNone: () =>
							Effect.succeed(
								HttpServerResponse.redirect(
									`/?${UrlParams.toString(UrlParams.fromInput({next: `${AUTH_URL}${request.url}`}))}`
								)
							),
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
				Effect.orElseSucceed(() => HttpServerResponse.redirect('/mcp-servers')),
				Effect.map(HttpServerResponse.setHeader('cache-control', 'no-store'))
			)
		)
		// A provider Auth registered with answers at its server's own callback; one using Auth's metadata document at the shared one.
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
					HttpServerResponse.redirect('/mcp-servers'),
					`__Host-mcp-${params.state}`,
					COOKIE
				)
			},
			Effect.orElseSucceed(() => HttpServerResponse.redirect('/mcp-servers')),
			Effect.map(HttpServerResponse.setHeader('cache-control', 'no-store'))
		)
		yield* router.add('GET', '/auth/mcp/callback', callback(Option.none()))
		yield* router.add(
			'GET',
			'/auth/mcp/callback/:id',
			Effect.flatMap(HttpRouter.params, params => callback(Option.fromUndefinedOr(params['id'])))
		)
	})
)
