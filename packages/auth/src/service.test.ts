import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	Clock,
	ConfigProvider,
	Crypto,
	Effect,
	FileSystem,
	Fiber,
	Layer,
	Order,
	Queue,
	Schema,
	String,
	Stream,
	pipe
} from 'effect'

import {Base64Url} from 'effect/encoding'
import {HttpClient, HttpClientResponse, HttpRouter, HttpServerRequest, HttpServerResponse, UrlParams} from 'effect/http'
import {TestClock} from 'effect/testing'

import type {Resource} from '#schema.ts'
import {
	AuthorizationStatus,
	ClientRegistration,
	ConsentParams,
	PendingAuthorization,
	Registration,
	RequestParams,
	TokenResponse,
	User
} from '#schema.ts'
import {Auth, Authorizations, HttpAuth} from '#service.ts'

import {CurrentUser} from '#lib/utils.ts'

const AUTH = 'https://auth.example.test'
const API = 'https://stash.mp281x.xyz'
const VERIFIER = String.repeat(43)('x')

const me = pipe(
	HttpRouter.add('GET', '/me', Effect.flatMap(CurrentUser, HttpServerResponse.schemaJson(User))),
	Layer.provide(HttpAuth.layer)
)

const servers = Effect.gen(function* () {
	const directory = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
	const random = yield* Crypto.Crypto
	const clock = yield* Clock.Clock
	const ready = yield* Queue.make<true>()
	const github = HttpClient.make(request =>
		Effect.gen(function* () {
			if (request.url === 'https://github.com/login/oauth/access_token' && request.body._tag === 'Uint8Array') {
				const form = new URLSearchParams(new TextDecoder().decode(request.body.body))
				const [login, challenge] = String.split(form.get('code') ?? '', '.')
				if (
					Base64Url.encode(
						yield* Effect.orDie(random.digest('SHA-256', new TextEncoder().encode(form.get('code_verifier') ?? '')))
					) !== challenge
				) {
					return HttpClientResponse.fromWeb(request, Response.json({error: 'bad_verification_code'}))
				}
				return HttpClientResponse.fromWeb(request, Response.json({access_token: login}))
			}
			const login = String.replace('Bearer ', '')(request.headers['authorization'] ?? '')
			return HttpClientResponse.fromWeb(
				request,
				Response.json({id: Boolean.match(login === 'octocat', {onFalse: () => 7, onTrue: () => 42}), login})
			)
		})
	)
	const issuer = yield* Effect.acquireRelease(
		Effect.sync(() =>
			HttpRouter.toWebHandler(
				pipe(
					Layer.mergeAll(
						me,
						HttpRouter.add(
							'GET',
							'/auth/request',
							pipe(
								Effect.gen(function* () {
									const params = yield* HttpServerRequest.schemaSearchParams(RequestParams)
									return yield* HttpServerResponse.schemaJson(AuthorizationStatus)(
										yield* Effect.flatMap(
											Stream.runHead(
												(yield* Authorizations).wait(
													params.request,
													(yield* HttpServerRequest.HttpServerRequest).headers
												)
											),
											Effect.fromOption
										)
									)
								}),
								Effect.catchTag('AuthError', () => Effect.succeed(HttpServerResponse.empty({status: 400})))
							)
						),
						pipe(
							Layer.merge(
								HttpRouter.add(
									'GET',
									'/pending',
									Effect.gen(function* () {
										return yield* HttpServerResponse.schemaJson(Schema.Array(PendingAuthorization))(
											yield* Effect.flatMap(
												Stream.runHead(
													(yield* Authorizations).pending((yield* HttpServerRequest.HttpServerRequest).headers)
												),
												Effect.fromOption
											)
										)
									})
								),
								HttpRouter.add(
									'GET',
									'/events',
									Effect.gen(function* () {
										return HttpServerResponse.stream(
											pipe(
												(yield* Authorizations).pending((yield* HttpServerRequest.HttpServerRequest).headers),
												Stream.take(2),
												Stream.mapEffect((snapshot, index) =>
													Effect.gen(function* () {
														if (index === 0) yield* Queue.offer(ready, true)
														return yield* Schema.encodeEffect(
															Schema.fromJsonString(Schema.Array(PendingAuthorization))
														)(snapshot)
													})
												),
												Stream.map(value => new TextEncoder().encode(`${value}\n`))
											)
										)
									})
								)
							),
							Layer.provide(HttpAuth.layer)
						)
					),
					Layer.provideMerge(Auth.layerIssuer),
					Layer.provide(
						Layer.mergeAll(
							NodeServices.layer,
							Layer.succeed(HttpClient.HttpClient, github),
							ConfigProvider.layer(
								ConfigProvider.fromUnknown({
									AUTH_URL: AUTH,
									GITHUB_CLIENT_ID: 'fixture',
									GITHUB_CLIENT_SECRET: 'fixture',
									GITHUB_USERS: '42',
									HOME: directory,
									NODE_ENV: 'production'
								})
							)
						)
					),
					Layer.provideMerge(Layer.succeed(Clock.Clock, clock))
				),
				{disableLogger: true}
			)
		),
		web => Effect.promise(() => web.dispose())
	)
	const app = yield* Effect.acquireRelease(
		Effect.sync(() =>
			HttpRouter.toWebHandler(
				pipe(
					me,
					Layer.provide(Auth.layer(API)),
					Layer.provide(
						Layer.merge(
							Layer.succeed(
								HttpClient.HttpClient,
								HttpClient.make(request =>
									Effect.map(
										Effect.promise(() =>
											issuer.handler(
												new Request(new URL(`${request.url}?${UrlParams.toString(request.urlParams)}`), {
													headers: request.headers
												})
											)
										),
										response => HttpClientResponse.fromWeb(request, response)
									)
								)
							),
							ConfigProvider.layer(ConfigProvider.fromUnknown({AUTH_URL: AUTH, NODE_ENV: 'production'}))
						)
					)
				),
				{disableLogger: true}
			)
		),
		web => Effect.promise(() => web.dispose())
	)
	return {app, issuer, ready}
})

function send(web: Effect.Success<typeof servers>['issuer'], path: string, init?: RequestInit) {
	return Effect.promise(() => web.handler(new Request(new URL(path, AUTH), init)))
}

function cookie(response: Response) {
	return pipe(
		response.headers.getSetCookie(),
		Array.map(value => Array.headNonEmpty(String.split(value, ';'))),
		Array.join('; ')
	)
}

const signIn = Effect.fnUntraced(function* (web: Effect.Success<typeof servers>['issuer'], login: string) {
	const start = yield* send(web, '/auth/github')
	const target = new URL(start.headers.get('location') ?? '')
	return yield* send(
		web,
		`/auth/github/callback?${UrlParams.toString(
			UrlParams.fromInput({
				code: `${login}.${target.searchParams.get('code_challenge') ?? ''}`,
				state: target.searchParams.get('state') ?? ''
			})
		)}`,
		{headers: {cookie: cookie(start)}}
	)
})

const authorize = Effect.fnUntraced(function* (
	web: Effect.Success<typeof servers>['issuer'],
	session: string,
	redirect: string,
	resources: Resource[]
) {
	const registered = yield* send(web, '/api/auth/oauth2/register', {
		body: yield* Schema.encodeEffect(Schema.fromJsonString(Registration))({
			client_name: 'opencode',
			redirect_uris: [redirect],
			token_endpoint_auth_method: 'none'
		}),
		headers: {'content-type': 'application/json'},
		method: 'POST'
	})
	assert.strictEqual(registered.status, 201)
	const registration = yield* Schema.decodeEffect(Schema.fromJsonString(ClientRegistration))(
		yield* Effect.promise(() => registered.text())
	)
	const request = yield* send(
		web,
		`/api/auth/oauth2/authorize?${UrlParams.toString(
			UrlParams.fromInput({
				client_id: registration.client_id,
				code_challenge: Base64Url.encode(
					yield* (yield* Crypto.Crypto).digest('SHA-256', new TextEncoder().encode(VERIFIER))
				),
				code_challenge_method: 'S256',
				redirect_uri: redirect,
				resource: resources,
				response_type: 'code',
				scope: 'deslop offline_access',
				state: 'fixture-state'
			})
		)}`
	)
	assert.strictEqual(request.status, 302)
	return {
		clientId: registration.client_id,
		cookie: pipe([session, cookie(request)], Array.filter(String.isNonEmpty), Array.join('; ')),
		id: new URL(request.headers.get('location') ?? '', AUTH).searchParams.get('request') ?? '',
		redirect,
		resources
	}
})

const consent = Effect.fnUntraced(function* (
	web: Effect.Success<typeof servers>['issuer'],
	request: Effect.Success<ReturnType<typeof authorize>>,
	accept: boolean
) {
	const response = yield* send(web, '/api/auth/oauth2/consent', {
		body: yield* Schema.encodeEffect(Schema.fromJsonString(ConsentParams))({accept, request: request.id}),
		headers: {'content-type': 'application/json', cookie: request.cookie, origin: AUTH},
		method: 'POST'
	})
	assert.strictEqual(response.status, 204)
	const receiver = yield* send(web, `/auth/request?request=${request.id}`, {headers: {cookie: request.cookie}})
	const status = yield* Schema.decodeEffect(Schema.fromJsonString(AuthorizationStatus))(
		yield* Effect.promise(() => receiver.text())
	)
	assert.strictEqual(status._tag, 'Completed')
	if (status._tag !== 'Completed') return yield* Effect.die('Expected a completed authorization')
	return new URL(status.url)
})

const exchange = Effect.fnUntraced(function* (
	web: Effect.Success<typeof servers>['issuer'],
	request: Effect.Success<ReturnType<typeof authorize>>,
	code: string
) {
	return yield* send(web, '/api/auth/oauth2/token', {
		body: UrlParams.toString(
			UrlParams.fromInput({
				client_id: request.clientId,
				code,
				code_verifier: VERIFIER,
				grant_type: 'authorization_code',
				redirect_uri: request.redirect,
				resource: request.resources
			})
		),
		headers: {'content-type': 'application/x-www-form-urlencoded'},
		method: 'POST'
	})
})

const refresh = Effect.fnUntraced(function* (
	web: Effect.Success<typeof servers>['issuer'],
	clientId: string,
	token: string
) {
	return yield* send(web, '/api/auth/oauth2/token', {
		body: UrlParams.toString(
			UrlParams.fromInput({client_id: clientId, grant_type: 'refresh_token', refresh_token: token})
		),
		headers: {'content-type': 'application/x-www-form-urlencoded'},
		method: 'POST'
	})
})

it.layer(NodeServices.layer)(test => {
	test.effect('approves from a separate session while only the originating browser receives the callback', () =>
		Effect.gen(function* () {
			const web = yield* servers
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			assert.strictEqual((yield* send(web.issuer, '/pending')).status, 401)
			const first = yield* authorize(web.issuer, '', 'http://127.0.0.1:34567/callback', [
				'https://scope.mp281x.xyz/mcp'
			])
			const second = yield* authorize(web.issuer, '', 'http://127.0.0.1:34568/callback', [
				'https://stash.mp281x.xyz/mcp'
			])
			const response = yield* send(web.issuer, '/pending', {headers: {cookie: session}})
			const body = yield* Effect.promise(() => response.text())
			assert.isFalse(String.includes('fixture-state')(body))
			assert.isFalse(String.includes('challenge')(body))
			assert.isFalse(String.includes(first.clientId)(body))
			assert.deepStrictEqual(
				Array.sort(
					Array.map(
						yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(PendingAuthorization)))(body),
						item => item.id
					),
					Order.String
				),
				Array.sort([first.id, second.id], Order.String)
			)
			assert.strictEqual(
				(yield* send(web.issuer, `/auth/request?request=${first.id}`, {headers: {cookie: session}})).status,
				400
			)
			assert.strictEqual(
				(yield* send(web.issuer, `/auth/request?request=${second.id}`, {headers: {cookie: first.cookie}})).status,
				400
			)
			const decision = yield* send(web.issuer, '/api/auth/oauth2/consent', {
				body: yield* Schema.encodeEffect(Schema.fromJsonString(ConsentParams))({accept: true, request: first.id}),
				headers: {'content-type': 'application/json', cookie: session, origin: AUTH},
				method: 'POST'
			})
			assert.strictEqual(decision.status, 204)
			assert.strictEqual(yield* Effect.promise(() => decision.text()), '')
			const callbackResponse = yield* send(web.issuer, `/auth/request?request=${first.id}`, {
				headers: {cookie: `${first.cookie}; ${second.cookie}`}
			})
			const callback = yield* Schema.decodeEffect(Schema.fromJsonString(AuthorizationStatus))(
				yield* Effect.promise(() => callbackResponse.text())
			)
			assert.strictEqual(callback._tag, 'Completed')
			if (callback._tag !== 'Completed') return yield* Effect.die('Expected a callback')
			const repeated = yield* send(web.issuer, `/auth/request?request=${first.id}`, {headers: {cookie: first.cookie}})
			assert.deepStrictEqual(
				yield* Schema.decodeEffect(Schema.fromJsonString(AuthorizationStatus))(
					yield* Effect.promise(() => repeated.text())
				),
				callback
			)
			assert.strictEqual(
				(yield* exchange(web.issuer, first, new URL(callback.url).searchParams.get('code') ?? '')).status,
				200
			)
			const waiting = yield* send(web.issuer, `/auth/request?request=${second.id}`, {
				headers: {cookie: `${first.cookie}; ${second.cookie}`}
			})
			assert.strictEqual(
				(yield* Schema.decodeEffect(Schema.fromJsonString(AuthorizationStatus))(
					yield* Effect.promise(() => waiting.text())
				))._tag,
				'Waiting'
			)
		})
	)

	test.effect('streams creations and expiration without refresh and rejects decisions after expiry', () =>
		Effect.gen(function* () {
			const web = yield* servers
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const creations = yield* pipe(
				send(web.issuer, '/events', {headers: {cookie: session}}),
				Effect.flatMap(response => Effect.promise(() => response.text())),
				Effect.forkScoped
			)
			yield* Queue.take(web.ready)
			const request = yield* authorize(web.issuer, '', 'http://127.0.0.1:34567/callback', [
				'https://portfolio.mp281x.xyz/mcp'
			])
			const created = yield* Effect.forEach(
				pipe(yield* Fiber.join(creations), String.trim, String.split('\n')),
				line => Schema.decodeEffect(Schema.fromJsonString(Schema.Array(PendingAuthorization)))(line),
				{concurrency: 1}
			)
			assert.deepStrictEqual(
				Array.map(created, snapshot => Array.map(snapshot, item => item.id)),
				[[], [request.id]]
			)
			const expirations = yield* pipe(
				send(web.issuer, '/events', {headers: {cookie: session}}),
				Effect.flatMap(response => Effect.promise(() => response.text())),
				Effect.forkScoped
			)
			yield* Queue.take(web.ready)
			yield* TestClock.adjust('241 seconds')
			const expired = yield* Effect.forEach(
				pipe(yield* Fiber.join(expirations), String.trim, String.split('\n')),
				line => Schema.decodeEffect(Schema.fromJsonString(Schema.Array(PendingAuthorization)))(line),
				{concurrency: 1}
			)
			assert.deepStrictEqual(
				Array.map(expired, snapshot => Array.map(snapshot, item => item.id)),
				[[request.id], []]
			)
			const receiver = yield* send(web.issuer, `/auth/request?request=${request.id}`, {
				headers: {cookie: request.cookie}
			})
			assert.deepStrictEqual(
				yield* Schema.decodeEffect(Schema.fromJsonString(AuthorizationStatus))(
					yield* Effect.promise(() => receiver.text())
				),
				{_tag: 'Expired'}
			)
			assert.strictEqual(
				(yield* send(web.issuer, '/api/auth/oauth2/consent', {
					body: yield* Schema.encodeEffect(Schema.fromJsonString(ConsentParams))({accept: true, request: request.id}),
					headers: {'content-type': 'application/json', cookie: session, origin: AUTH},
					method: 'POST'
				})).status,
				400
			)
		})
	)

	test.effect('accepts one decision across concurrent approving and denying sessions', () =>
		Effect.gen(function* () {
			const web = yield* servers
			const first = cookie(yield* signIn(web.issuer, 'octocat'))
			const second = cookie(yield* signIn(web.issuer, 'octocat'))
			const request = yield* authorize(web.issuer, '', 'http://127.0.0.1:34567/callback', [
				'https://scope.mp281x.xyz/mcp'
			])
			const responses = yield* Effect.forEach(
				[
					{accept: true, session: first},
					{accept: false, session: second}
				],
				Effect.fnUntraced(function* (decision) {
					return yield* send(web.issuer, '/api/auth/oauth2/consent', {
						body: yield* Schema.encodeEffect(Schema.fromJsonString(ConsentParams))({
							accept: decision.accept,
							request: request.id
						}),
						headers: {'content-type': 'application/json', cookie: decision.session, origin: AUTH},
						method: 'POST'
					})
				}),
				{concurrency: 'unbounded'}
			)
			assert.deepStrictEqual(
				Array.sort(
					Array.map(responses, response => response.status),
					Order.Number
				),
				[204, 400]
			)
			const pending = yield* send(web.issuer, '/pending', {headers: {cookie: first}})
			assert.deepStrictEqual(
				yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(PendingAuthorization)))(
					yield* Effect.promise(() => pending.text())
				),
				[]
			)
		})
	)

	test.effect('binds consent and one-use PKCE codes to the browser, client, callback and resources', () =>
		Effect.gen(function* () {
			const web = yield* servers
			assert.strictEqual((yield* send(web.app, '/me')).status, 401)
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			assert.strictEqual((yield* send(web.issuer, '/me', {headers: {cookie: session}})).status, 200)
			assert.strictEqual(
				(yield* send(web.app, '/me', {headers: {cookie: session, origin: 'https://portfolio.mp281x.xyz'}})).status,
				200
			)
			assert.strictEqual(
				(yield* send(web.app, '/me', {headers: {cookie: session, origin: 'https://evil.test'}})).status,
				401
			)
			assert.strictEqual(cookie(yield* signIn(web.issuer, 'stranger')), '__Host-login=')
			const request = yield* authorize(web.issuer, session, 'stash://auth/callback', [API, 'https://otel.mp281x.xyz'])
			assert.strictEqual(
				(yield* send(web.issuer, '/api/auth/oauth2/consent', {
					body: yield* Schema.encodeEffect(Schema.fromJsonString(ConsentParams))({accept: true, request: request.id}),
					headers: {'content-type': 'application/json', cookie: request.cookie, origin: 'https://evil.test'},
					method: 'POST'
				})).status,
				400
			)
			assert.strictEqual((yield* send(web.issuer, `/auth/request?request=${request.id}`)).status, 400)
			const callback = yield* consent(web.issuer, request, true)
			assert.strictEqual(callback.searchParams.get('iss'), `${AUTH}/api/auth`)
			assert.strictEqual(callback.searchParams.get('state'), 'fixture-state')
			const code = callback.searchParams.get('code') ?? ''
			assert.strictEqual(
				(yield* send(web.issuer, '/api/auth/oauth2/token', {
					body: UrlParams.toString(
						UrlParams.fromInput({
							client_id: request.clientId,
							code,
							code_verifier: 'wrong',
							grant_type: 'authorization_code',
							redirect_uri: request.redirect,
							resource: request.resources
						})
					),
					headers: {'content-type': 'application/x-www-form-urlencoded'},
					method: 'POST'
				})).status,
				400
			)
			const responses = yield* Effect.all([exchange(web.issuer, request, code), exchange(web.issuer, request, code)], {
				concurrency: 'unbounded'
			})
			assert.deepStrictEqual(
				Array.sort(
					Array.map(responses, response => response.status),
					Order.Number
				),
				[200, 400]
			)
			const response = yield* Effect.fromOption(Array.findFirst(responses, item => item.status === 200))
			const token = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => response.text())
			)
			assert.strictEqual(token.expires_in, 90_000)
			assert.strictEqual(
				(yield* send(web.app, '/me', {headers: {authorization: `Bearer ${token.access_token}`}})).status,
				200
			)
			assert.strictEqual(
				(yield* send(web.issuer, '/auth/verify?resource=https://scope.mp281x.xyz/mcp', {
					headers: {authorization: `Bearer ${token.access_token}`}
				})).status,
				401
			)
		})
	)

	test.effect('rotates refresh tokens, revokes a reused family, and revokes active access at sign-out', () =>
		Effect.gen(function* () {
			const web = yield* servers
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const request = yield* authorize(web.issuer, session, 'http://127.0.0.1:34567/callback', [
				'https://scope.mp281x.xyz/mcp'
			])
			const first = yield* exchange(
				web.issuer,
				request,
				(yield* consent(web.issuer, request, true)).searchParams.get('code') ?? ''
			)
			const token = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => first.text())
			)
			assert.strictEqual(token.expires_in, 900)
			const second = yield* refresh(web.issuer, request.clientId, token.refresh_token)
			const rotated = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => second.text())
			)
			assert.notStrictEqual(rotated.refresh_token, token.refresh_token)
			assert.strictEqual(
				(yield* send(web.issuer, '/auth/verify?resource=https://scope.mp281x.xyz/mcp', {
					headers: {authorization: `Bearer ${rotated.access_token}`}
				})).status,
				200
			)
			assert.strictEqual((yield* refresh(web.issuer, request.clientId, token.refresh_token)).status, 400)
			assert.strictEqual((yield* refresh(web.issuer, request.clientId, rotated.refresh_token)).status, 400)
			assert.strictEqual(
				(yield* send(web.issuer, '/auth/verify?resource=https://scope.mp281x.xyz/mcp', {
					headers: {authorization: `Bearer ${rotated.access_token}`}
				})).status,
				401
			)
			const next = yield* authorize(web.issuer, session, 'stash-dev://auth/callback', [API])
			const nextResponse = yield* exchange(
				web.issuer,
				next,
				(yield* consent(web.issuer, next, true)).searchParams.get('code') ?? ''
			)
			const active = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => nextResponse.text())
			)
			assert.strictEqual(
				(yield* send(web.issuer, '/api/auth/oauth2/revoke', {
					body: UrlParams.toString(UrlParams.fromInput({client_id: next.clientId, token: active.refresh_token})),
					headers: {'content-type': 'application/x-www-form-urlencoded'},
					method: 'POST'
				})).status,
				204
			)
			assert.strictEqual(
				(yield* send(web.app, '/me', {headers: {authorization: `Bearer ${active.access_token}`}})).status,
				401
			)
			assert.strictEqual(
				(yield* send(web.issuer, '/auth/sign-out', {headers: {cookie: session, origin: AUTH}, method: 'POST'})).status,
				204
			)
			assert.strictEqual((yield* send(web.issuer, '/me', {headers: {cookie: session}})).status, 401)
		})
	)

	test.effect('denies access without issuing a code and expires a code before exchange', () =>
		Effect.gen(function* () {
			const web = yield* servers
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const denied = yield* consent(
				web.issuer,
				yield* authorize(web.issuer, session, 'http://localhost:34567/callback', ['https://portfolio.mp281x.xyz/mcp']),
				false
			)
			assert.strictEqual(denied.searchParams.get('error'), 'access_denied')
			assert.isFalse(denied.searchParams.has('code'))
			const request = yield* authorize(web.issuer, session, 'stash://auth/callback', [API])
			const callback = yield* consent(web.issuer, request, true)
			yield* TestClock.adjust('61 seconds')
			assert.strictEqual((yield* exchange(web.issuer, request, callback.searchParams.get('code') ?? '')).status, 400)
		})
	)
})
