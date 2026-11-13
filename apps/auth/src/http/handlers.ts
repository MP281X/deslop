import {Array, Duration, Effect, Match, Option, Schema, String, pipe} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse, UrlParams} from 'effect/http'
import {RateLimiter} from 'effect/persistence'

import {
	APPS_PATH,
	AuthError,
	COOKIE,
	DEVICE_PATH,
	ISSUER_PATH,
	JWKS_PATH,
	SESSION_COOKIE,
	clientIdOf,
	failureOptions,
	asAuthError
} from '@deslop/runtime/shared/auth'

import {App, AppParams} from '#services/apps/schema.ts'
import {Apps} from '#services/apps/service.ts'
import {CallbackParams, LoginState, SignInParams} from '#services/github/schema.ts'
import {GitHub} from '#services/github/service.ts'
import {PasskeySignIn} from '#services/passkeys/schema.ts'
import {Passkeys} from '#services/passkeys/service.ts'
import {People} from '#services/people/service.ts'
import {SIGN_IN_LIFETIME, typedCode} from '#services/sign-ins/lib/utils.ts'
import {BrowserParams, RequestParams} from '#services/sign-ins/schema.ts'
import {REQUEST_COOKIE, SignIns} from '#services/sign-ins/service.ts'
import {
	addressGroup,
	allowedRedirect,
	browserToken,
	callbackUrl,
	clientAddress,
	clientRequest,
	originFrom,
	returnable,
	webRedirect
} from '#services/tokens/lib/utils.ts'
import {
	AuthorizeClient,
	AuthorizeParams,
	DEVICE_GRANT,
	DeviceParams,
	DeviceTokenParams,
	Registration,
	RevokeParams,
	TokenGrant,
	TokenParams
} from '#services/tokens/schema.ts'
import {Tokens} from '#services/tokens/service.ts'

const LOGIN_COOKIE = '__Host-login'

function session(seconds: number) {
	return {...COOKIE, maxAge: `${seconds} seconds` as const}
}

// OAuth endpoints answer failures as RFC 6749 JSON and are never cached.
function oauth<E, R>(handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) {
	return pipe(
		handler,
		Effect.catchIf(Schema.is(AuthError), failure =>
			Effect.succeed(
				HttpServerResponse.jsonUnsafe(
					{error: failure.error ?? 'invalid_request', error_description: failure.message},
					failureOptions(failure, 400)
				)
			)
		),
		Effect.map(HttpServerResponse.setHeaders({'cache-control': 'no-store', pragma: 'no-cache'}))
	)
}

function originOf(request: HttpServerRequest.HttpServerRequest) {
	return originFrom(request.headers, request.remoteAddress)
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

function returnTo(flow: SignInParams, origin: string) {
	return pipe(
		UrlParams.toString(UrlParams.fromInput({code: flow.code, request: flow.request})),
		Option.liftPredicate(String.isNonEmpty),
		Option.match({
			onNone: () =>
				pipe(
					Option.fromUndefinedOr(flow.next),
					Option.filter(next => returnable(next, origin)),
					Option.getOrElse(() => '/')
				),
			onSome: search => `/?${search}`
		})
	)
}

export const HttpHandlers = HttpRouter.use(router =>
	Effect.gen(function* () {
		const apps = yield* Apps
		const github = yield* GitHub
		const passkeys = yield* Passkeys
		const people = yield* People
		const signIns = yield* SignIns
		const tokens = yield* Tokens
		const limiter = yield* RateLimiter.RateLimiter
		const origin = new URL(tokens.issuer).origin
		// Anyone may call these, so each address (an IPv6 /64) gets a budget per minute; past it, 429. No shared budget, which one sender could spend for everyone.
		function limited(route: string, perAddress: number) {
			return Effect.fnUntraced(function* <E, R>(handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) {
				const request = yield* HttpServerRequest.HttpServerRequest
				const address = pipe(
					clientAddress(request.headers, request.remoteAddress),
					Option.map(addressGroup),
					Option.getOrElse(() => 'unknown')
				)
				return yield* Effect.matchEffect(
					limiter.consume({key: `${route}:${address}`, limit: perAddress, onExceeded: 'fail', window: '1 minute'}),
					{
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
					}
				)
			})
		}

		yield* router.add(
			'GET',
			JWKS_PATH,
			HttpServerResponse.jsonUnsafe(tokens.jwks, {headers: {'cache-control': 'public, max-age=300'}})
		)
		// Each app's server announces itself here at start; see `layerAnnounce` in `@deslop/runtime/server/http`.
		yield* router.add(
			'POST',
			APPS_PATH,
			limited(
				'apps',
				10
			)(
				Effect.catchIf(
					Effect.gen(function* () {
						const params = yield* asAuthError('Send the app’s origin')(HttpServerRequest.schemaBodyJson(AppParams))
						return yield* HttpServerResponse.schemaJson(App.json)(yield* apps.register(params.origin))
					}),
					Schema.is(AuthError),
					failure => Effect.succeed(HttpServerResponse.text(failure.message, failureOptions(failure, 403)))
				)
			)
		)
		yield* router.add(
			'GET',
			`/.well-known/oauth-authorization-server${ISSUER_PATH}`,
			HttpServerResponse.jsonUnsafe({
				authorization_endpoint: `${tokens.issuer}/oauth2/authorize`,
				authorization_response_iss_parameter_supported: true,
				code_challenge_methods_supported: ['S256'],
				device_authorization_endpoint: `${origin}${DEVICE_PATH}`,
				grant_types_supported: ['authorization_code', 'refresh_token', DEVICE_GRANT],
				issuer: tokens.issuer,
				jwks_uri: `${origin}${JWKS_PATH}`,
				registration_endpoint: `${tokens.issuer}/oauth2/register`,
				response_types_supported: ['code'],
				revocation_endpoint: `${tokens.issuer}/oauth2/revoke`,
				scopes_supported: ['deslop', 'offline_access'],
				token_endpoint: `${tokens.issuer}/oauth2/token`,
				token_endpoint_auth_methods_supported: ['none']
			})
		)
		yield* router.add(
			'POST',
			`${ISSUER_PATH}/oauth2/register`,
			limited(
				'register',
				10
			)(
				oauth(
					Effect.gen(function* () {
						const params = yield* Effect.mapError(HttpServerRequest.schemaBodyJson(Registration), cause =>
							AuthError.make({
								cause,
								error: 'invalid_client_metadata',
								message: 'Send up to 4 redirect_uris of at most 200 characters and a client_name of at most 100'
							})
						)
						if (!Array.every(params.redirect_uris, allowedRedirect)) {
							return yield* AuthError.make({
								error: 'invalid_redirect_uri',
								message: 'Use a Deslop web or iOS callback, a loopback callback or a Gateway server callback'
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
		// First-party web apps reuse this browser's session; other clients wait for an approval by code.
		yield* router.add(
			'GET',
			`${ISSUER_PATH}/oauth2/authorize`,
			limited(
				'authorize',
				20
			)(
				oauth(
					Effect.gen(function* () {
						const request = yield* HttpServerRequest.HttpServerRequest
						// Until the client and its callback check out, an error stays on this page: RFC 9700 §4.11 forbids redirecting it.
						const asked = yield* asAuthError('The authorization request names no client_id')(
							HttpServerRequest.schemaSearchParams(AuthorizeClient)
						)
						const client = yield* tokens.client(asked)
						return yield* pipe(
							HttpServerRequest.schemaSearchParams(AuthorizeParams),
							asAuthError('Invalid authorization request'),
							Effect.flatMap(params => clientRequest(asked, client, params)),
							Effect.flatMap(
								Effect.fnUntraced(function* (checked) {
									if (!webRedirect(checked.redirectUri)) {
										return waitingAt(yield* signIns.start({_tag: 'Client', request: checked}, originOf(request)))
									}
									const browser = yield* pipe(
										tokens.browserSession(request.headers),
										Effect.tap(found => people.allowed(found.owner)),
										Effect.result
									)
									if (browser._tag === 'Failure') {
										if (
											browser.failure.error === 'temporarily_unavailable' ||
											browser.failure.error === 'access_denied'
										) {
											return yield* browser.failure
										}
										return HttpServerResponse.redirect(
											`/?${new URLSearchParams({next: new URL(request.url, origin).href})}`
										)
									}
									return HttpServerResponse.redirect(
										callbackUrl(
											checked,
											{code: yield* tokens.issue({...checked, parent: browser.success.family}, browser.success.owner)},
											tokens.issuer
										)
									)
								})
							),
							Effect.catchIf(Schema.is(AuthError), failure =>
								Effect.succeed(
									HttpServerResponse.redirect(
										callbackUrl(
											{
												redirectUri: client.redirectUri,
												...Option.match(Option.fromUndefinedOr(asked.state), {
													onNone: () => ({}),
													onSome: state => ({state})
												})
											},
											{error: failure.error ?? 'invalid_request', error_description: failure.message},
											tokens.issuer
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
			DEVICE_PATH,
			limited(
				'device',
				10
			)(
				oauth(
					Effect.gen(function* () {
						const request = yield* HttpServerRequest.HttpServerRequest
						const params = yield* asAuthError('Send a client_id')(HttpServerRequest.schemaBodyUrlParams(DeviceParams))
						const started = yield* signIns.start(
							{
								_tag: 'Device',
								request: {
									clientId: params.client_id,
									clientName: (yield* tokens.client({client_id: params.client_id})).clientName
								}
							},
							originOf(request)
						)
						return HttpServerResponse.jsonUnsafe({
							device_code: started.receiver,
							expires_in: Duration.toSeconds(SIGN_IN_LIFETIME),
							interval: 2,
							user_code: started.code,
							verification_uri: `${origin}/`,
							verification_uri_complete: `${origin}/?${new URLSearchParams({code: started.code})}`
						})
					})
				)
			)
		)
		yield* router.add(
			'POST',
			`${ISSUER_PATH}/oauth2/token`,
			limited(
				'token',
				60
			)(
				oauth(
					Effect.gen(function* () {
						const grant = yield* asAuthError('Send a grant_type')(HttpServerRequest.schemaBodyUrlParams(TokenGrant))
						if (grant.grant_type === DEVICE_GRANT) {
							return HttpServerResponse.jsonUnsafe(
								yield* signIns.poll(
									yield* asAuthError('Send the device_code and client_id')(
										HttpServerRequest.schemaBodyUrlParams(DeviceTokenParams)
									)
								)
							)
						}
						if (grant.grant_type !== 'authorization_code' && grant.grant_type !== 'refresh_token') {
							return yield* AuthError.make({
								error: 'unsupported_grant_type',
								message: `Use grant_type authorization_code, refresh_token or ${DEVICE_GRANT}`
							})
						}
						return Match.valueTags(
							yield* tokens.exchange(
								yield* asAuthError('Invalid token request')(HttpServerRequest.schemaBodyUrlParams(TokenParams)),
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
			`${ISSUER_PATH}/oauth2/revoke`,
			limited(
				'revoke',
				60
			)(
				oauth(
					Effect.gen(function* () {
						yield* tokens.revoke(
							yield* asAuthError('Invalid revocation request')(HttpServerRequest.schemaBodyUrlParams(RevokeParams))
						)
						return HttpServerResponse.empty({status: 200})
					})
				)
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
							yield* asAuthError('Invalid sign-in request')(HttpServerRequest.schemaSearchParams(SignInParams))
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
			Effect.catch(
				Effect.gen(function* () {
					const params = yield* asAuthError('GitHub sent no code')(HttpServerRequest.schemaSearchParams(CallbackParams))
					if ((yield* HttpServerRequest.HttpServerRequest).cookies[LOGIN_COOKIE] !== params.state) {
						return yield* AuthError.make({message: 'The sign-in state does not match'})
					}
					const request = yield* HttpServerRequest.HttpServerRequest
					const finished = yield* github.finish(params.code, params.state)
					return yield* pipe(
						people.register(finished.profile),
						Effect.flatMap(user =>
							tokens.startSession(user, originOf(request), 'GitHub', browserToken(request.headers))
						),
						Effect.map(started =>
							pipe(
								HttpServerResponse.redirect(returnTo(finished.flow, origin)),
								HttpServerResponse.expireCookieUnsafe(LOGIN_COOKIE, COOKIE),
								HttpServerResponse.setCookieUnsafe(SESSION_COOKIE, started.token, session(started.seconds))
							)
						),
						Effect.catch(cause => githubFailed(cause, Option.some(finished.flow)))
					)
				}),
				cause =>
					Effect.flatMap(
						Effect.option(
							Effect.flatMap(HttpServerRequest.schemaSearchParams(LoginState), found => github.cancel(found.state))
						),
						flow => githubFailed(cause, flow)
					)
			)
		)
		yield* router.add(
			'GET',
			'/auth/code',
			limited(
				'code',
				20
			)(
				oauth(
					Effect.gen(function* () {
						const next = (yield* asAuthError('Invalid sign-in request')(
							HttpServerRequest.schemaSearchParams(BrowserParams)
						)).next
						return waitingAt(
							yield* signIns.start(
								{
									_tag: 'Browser',
									...pipe(
										Option.fromUndefinedOr(next),
										Option.filter(page => returnable(page, origin)),
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
		// A passkey signs this browser in at once. Its options name no account, since each passkey holds its own.
		yield* router.add(
			'GET',
			'/auth/passkey',
			limited('passkey', 20)(oauth(Effect.map(passkeys.request, options => HttpServerResponse.jsonUnsafe(options))))
		)
		yield* router.add(
			'POST',
			'/auth/passkey',
			limited(
				'passkey',
				20
			)(
				oauth(
					Effect.gen(function* () {
						const request = yield* HttpServerRequest.HttpServerRequest
						const input = yield* asAuthError('Send the passkey’s answer')(
							HttpServerRequest.schemaBodyJson(PasskeySignIn)
						)
						const started = yield* tokens.startSession(
							yield* people.allowed(yield* passkeys.signIn(input.response)),
							originOf(request),
							'Passkey',
							browserToken(request.headers)
						)
						return HttpServerResponse.setCookieUnsafe(
							HttpServerResponse.jsonUnsafe(
								pipe(
									Option.fromUndefinedOr(input.next),
									Option.filter(page => returnable(page, origin)),
									Option.match({onNone: () => ({}), onSome: next => ({next})})
								)
							),
							SESSION_COOKIE,
							started.token,
							session(started.seconds)
						)
					})
				)
			)
		)
		yield* router.add(
			'GET',
			'/auth/continue',
			pipe(
				Effect.gen(function* () {
					const request = yield* HttpServerRequest.HttpServerRequest
					const params = yield* asAuthError('Name the sign-in')(HttpServerRequest.schemaSearchParams(RequestParams))
					const collected = yield* signIns.collect(params.request, request.headers)
					const cookie = `${REQUEST_COOKIE}${typedCode(params.request)}`
					return Match.valueTags(collected, {
						// Denied and Granted answer a command through its device code, so a browser that lands here gets an error.
						Denied: () => HttpServerResponse.text('This sign-in belongs to a command', {status: 400}),
						Granted: () => HttpServerResponse.text('This sign-in belongs to a command', {status: 400}),
						Redirect: found =>
							HttpServerResponse.expireCookieUnsafe(HttpServerResponse.redirect(found.url), cookie, COOKIE),
						Session: found =>
							pipe(
								HttpServerResponse.redirect(found.next ?? '/'),
								HttpServerResponse.expireCookieUnsafe(cookie, COOKIE),
								HttpServerResponse.setCookieUnsafe(SESSION_COOKIE, found.token, session(found.seconds))
							)
					})
				}),
				asAuthError('Cannot complete the sign-in'),
				Effect.catch(failure => Effect.succeed(HttpServerResponse.text(failure.message, {status: 400}))),
				Effect.map(HttpServerResponse.setHeader('cache-control', 'no-store'))
			)
		)
		yield* router.add(
			'POST',
			'/auth/sign-out',
			oauth(
				Effect.gen(function* () {
					yield* tokens.endSession((yield* HttpServerRequest.HttpServerRequest).headers)
					return HttpServerResponse.expireCookieUnsafe(HttpServerResponse.empty(), SESSION_COOKIE, COOKIE)
				})
			)
		)
	})
)
