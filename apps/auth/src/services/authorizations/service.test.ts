import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Clock,
	ConfigProvider,
	Effect,
	FileSystem,
	Fiber,
	Layer,
	Option,
	Order,
	Queue,
	Schema,
	String,
	Stream,
	pipe
} from 'effect'

import {Digest} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {HttpClient, HttpClientResponse, HttpRouter, HttpServerRequest, HttpServerResponse, UrlParams} from 'effect/http'
import {TestClock} from 'effect/testing'

import type {Resource} from '@deslop/runtime/auth/schema'
import {ClientRegistration, TokenResponse, User} from '@deslop/runtime/auth/schema'
import {Auth, HttpAuth} from '@deslop/runtime/auth/service'
import {AUTH_URL, CurrentUser} from '@deslop/runtime/auth/utils'

import {
	AuthorizationStatus,
	CodeParams,
	ConsentParams,
	FamilyParams,
	PendingAuthorization,
	Person,
	Registration,
	RequestParams,
	SignedInApp
} from '#services/authorizations/schema.ts'
import {Authorizations} from '#services/authorizations/service.ts'
import {layerMcp} from '#tools/handlers.ts'

const API = 'https://stash.mp281x.xyz'
const APPROVALS = 'https://auth.mp281x.xyz/mcp'
const GITHUB_IDS: Record<string, number> = {drifter: 9, octocat: 42, stranger: 7}
const VERIFIER = String.repeat(43)('x')

const me = pipe(
	HttpRouter.add('GET', '/me', Effect.flatMap(CurrentUser, HttpServerResponse.schemaJson(User))),
	Layer.provide(HttpAuth.layer)
)

const servers = Effect.fnUntraced(function* (home?: string) {
	const directory = home ?? (yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped())
	const digest = yield* Digest.Digest
	const clock = yield* Clock.Clock
	const ready = yield* Queue.make<true>()
	const github = HttpClient.make(request =>
		Effect.gen(function* () {
			if (request.url === 'https://github.com/login/oauth/access_token' && request.body._tag === 'Uint8Array') {
				const form = new URLSearchParams(new TextDecoder().decode(request.body.body))
				const [login, challenge] = String.split(form.get('code') ?? '', '.')
				if (
					Base64Url.encode(
						yield* digest.digest(Digest.sha256, new TextEncoder().encode(form.get('code_verifier') ?? ''))
					) !== challenge
				) {
					return HttpClientResponse.fromWeb(request, Response.json({error: 'bad_verification_code'}))
				}
				return HttpClientResponse.fromWeb(request, Response.json({access_token: login}))
			}
			const login = String.replace('Bearer ', '')(request.headers['authorization'] ?? '')
			return HttpClientResponse.fromWeb(
				request,
				Response.json({id: GITHUB_IDS[login] ?? 1, login, name: `${login} example`})
			)
		})
	)
	const issuer = yield* Effect.acquireRelease(
		Effect.sync(() =>
			HttpRouter.toWebHandler(
				pipe(
					Layer.mergeAll(
						me,
						layerMcp,
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
							Layer.mergeAll(
								HttpRouter.add(
									'GET',
									'/apps',
									Effect.gen(function* () {
										return yield* HttpServerResponse.schemaJson(Schema.Array(SignedInApp))(
											yield* Effect.flatMap(
												Stream.runHead((yield* Authorizations).apps(yield* CurrentUser)),
												Effect.fromOption
											)
										)
									})
								),
								HttpRouter.add(
									'POST',
									'/disconnect',
									pipe(
										Effect.gen(function* () {
											const params = yield* HttpServerRequest.schemaSearchParams(FamilyParams)
											yield* (yield* Authorizations).disconnect(params.family, yield* CurrentUser)
											return HttpServerResponse.empty()
										}),
										Effect.catchTag('AuthError', () => Effect.succeed(HttpServerResponse.empty({status: 400})))
									)
								),
								HttpRouter.add(
									'GET',
									'/lookup',
									Effect.gen(function* () {
										const params = yield* HttpServerRequest.schemaSearchParams(CodeParams)
										return yield* HttpServerResponse.schemaJson(Schema.Array(PendingAuthorization))(
											Option.toArray(
												yield* Effect.flatMap(
													Stream.runHead(
														(yield* Authorizations).lookup(
															params.code,
															(yield* HttpServerRequest.HttpServerRequest).headers
														)
													),
													Effect.fromOption
												)
											)
										)
									})
								),
								HttpRouter.add(
									'GET',
									'/events',
									Effect.gen(function* () {
										const params = yield* HttpServerRequest.schemaSearchParams(CodeParams)
										return HttpServerResponse.stream(
											pipe(
												(yield* Authorizations).lookup(
													params.code,
													(yield* HttpServerRequest.HttpServerRequest).headers
												),
												Stream.take(2),
												Stream.mapEffect((found, index) =>
													Effect.gen(function* () {
														if (index === 0) yield* Queue.offer(ready, true)
														return yield* Schema.encodeEffect(
															Schema.fromJsonString(Schema.Array(PendingAuthorization))
														)(Option.toArray(found))
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
					Layer.provideMerge(Authorizations.layer),
					Layer.provide(
						Layer.mergeAll(
							NodeCrypto.layer,
							NodeServices.layer,
							Layer.succeed(HttpClient.HttpClient, github),
							ConfigProvider.layer(
								ConfigProvider.fromUnknown({
									GITHUB_ADMINS: '42',
									GITHUB_CLIENT_ID: 'example',
									GITHUB_CLIENT_SECRET: 'example',
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
							ConfigProvider.layer(ConfigProvider.fromUnknown({NODE_ENV: 'production'}))
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

function send(web: Effect.Success<ReturnType<typeof servers>>['issuer'], path: string, init?: RequestInit) {
	return Effect.promise(() => web.handler(new Request(new URL(path, AUTH_URL), init)))
}

function cookie(response: Response) {
	return pipe(
		response.headers.getSetCookie(),
		Array.map(value => Array.headNonEmpty(String.split(value, ';'))),
		Array.join('; ')
	)
}

const signIn = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	login: string,
	search = ''
) {
	const start = yield* send(web, `/auth/github${search}`)
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
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
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
					yield* (yield* Digest.Digest).digest(Digest.sha256, new TextEncoder().encode(VERIFIER))
				),
				code_challenge_method: 'S256',
				redirect_uri: redirect,
				resource: resources,
				response_type: 'code',
				scope: 'deslop offline_access',
				state: 'example-state'
			})
		)}`
	)
	assert.strictEqual(request.status, 302)
	return {
		clientId: registration.client_id,
		cookie: pipe([session, cookie(request)], Array.filter(String.isNonEmpty), Array.join('; ')),
		id: new URL(request.headers.get('location') ?? '', AUTH_URL).searchParams.get('request') ?? '',
		redirect,
		resources
	}
})

const consent = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	request: Effect.Success<ReturnType<typeof authorize>>,
	accept: boolean
) {
	const response = yield* send(web, '/api/auth/oauth2/consent', {
		body: yield* Schema.encodeEffect(Schema.fromJsonString(ConsentParams))({accept, request: request.id}),
		headers: {'content-type': 'application/json', cookie: request.cookie, origin: AUTH_URL},
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

// An MCP client's initialize, then the tool call with the session it got.
const callTool = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	token: string,
	name: string,
	input: Record<string, unknown>
) {
	const headers = {
		accept: 'application/json, text/event-stream',
		authorization: `Bearer ${token}`,
		'content-type': 'application/json',
		'mcp-protocol-version': '2025-06-18'
	}
	const opened = yield* send(web, '/mcp', {
		body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
			id: 1,
			jsonrpc: '2.0',
			method: 'initialize',
			params: {capabilities: {}, clientInfo: {name: 'agent', version: '1'}, protocolVersion: '2025-06-18'}
		}),
		headers,
		method: 'POST'
	})
	if (opened.status !== 200) return opened
	return yield* send(web, '/mcp', {
		body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
			id: 2,
			jsonrpc: '2.0',
			method: 'tools/call',
			params: {arguments: input, name}
		}),
		headers: {...headers, 'mcp-session-id': opened.headers.get('mcp-session-id') ?? ''},
		method: 'POST'
	})
})

const exchange = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
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
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
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

// An agent's auth MCP token, approved in the browser of the signed-in session.
const agentToken = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	session: string
) {
	const agent = yield* authorize(web, session, 'http://127.0.0.1:34569/callback', [APPROVALS])
	const granted = yield* exchange(web, agent, (yield* consent(web, agent, true)).searchParams.get('code') ?? '')
	return (yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(yield* Effect.promise(() => granted.text())))
		.access_token
})

const people = Effect.fnUntraced(function* (web: Effect.Success<ReturnType<typeof servers>>['issuer'], token: string) {
	const response = yield* callTool(web, token, 'list_people', {})
	return Array.map(
		(yield* Schema.decodeEffect(
			Schema.fromJsonString(
				Schema.Struct({result: Schema.Struct({structuredContent: Schema.Struct({people: Schema.Array(Person)})})})
			)
		)(yield* Effect.promise(() => response.text()))).result.structuredContent.people,
		person => `${person.name}:${person.role}`
	)
})

it.layer(Layer.merge(NodeCrypto.layer, NodeServices.layer))(test => {
	test.effect('keeps sessions, rotated tokens and revocations across restarts', () =>
		Effect.gen(function* () {
			const home = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const saved = yield* Effect.scoped(
				Effect.gen(function* () {
					const web = yield* servers(home)
					const session = cookie(yield* signIn(web.issuer, 'octocat'))
					const request = yield* authorize(web.issuer, session, 'opm://auth/callback', [API])
					const response = yield* exchange(
						web.issuer,
						request,
						(yield* consent(web.issuer, request, true)).searchParams.get('code') ?? ''
					)
					const first = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
						yield* Effect.promise(() => response.text())
					)
					const rotated = yield* refresh(web.issuer, request.clientId, first.refresh_token)
					const token = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
						yield* Effect.promise(() => rotated.text())
					)
					return {clientId: request.clientId, first, session, token}
				})
			)
			yield* Effect.scoped(
				Effect.gen(function* () {
					const web = yield* servers(home)
					assert.strictEqual((yield* send(web.issuer, '/auth/session', {headers: {cookie: saved.session}})).status, 200)
					assert.strictEqual(
						(yield* send(web.issuer, `/auth/verify?resource=${API}`, {
							headers: {authorization: `Bearer ${saved.token.access_token}`}
						})).status,
						200
					)
					assert.strictEqual((yield* refresh(web.issuer, saved.clientId, saved.first.refresh_token)).status, 400)
				})
			)
			const web = yield* servers(home)
			assert.strictEqual((yield* refresh(web.issuer, saved.clientId, saved.token.refresh_token)).status, 400)
			assert.strictEqual(
				(yield* send(web.issuer, `/auth/verify?resource=${API}`, {
					headers: {authorization: `Bearer ${saved.token.access_token}`}
				})).status,
				401
			)
		})
	)

	test.effect('approves from a separate session while only the originating browser receives the callback', () =>
		Effect.gen(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const first = yield* authorize(web.issuer, '', 'http://127.0.0.1:34567/callback', [
				'https://scope.mp281x.xyz/mcp'
			])
			const second = yield* authorize(web.issuer, '', 'http://127.0.0.1:34568/callback', [
				'https://stash.mp281x.xyz/mcp'
			])
			assert.strictEqual((yield* send(web.issuer, `/lookup?code=${first.id}`)).status, 401)
			const lookup = Effect.fnUntraced(function* (code: string) {
				const response = yield* send(web.issuer, `/lookup?code=${code}`, {headers: {cookie: session}})
				const body = yield* Effect.promise(() => response.text())
				return {
					body,
					ids: Array.map(
						yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(PendingAuthorization)))(body),
						item => item.id
					)
				}
			})
			const found = yield* lookup(String.toLowerCase(`${String.slice(0, 4)(first.id)}-${String.slice(4)(first.id)}`))
			assert.isFalse(String.includes('example-state')(found.body))
			assert.isFalse(String.includes('challenge')(found.body))
			assert.isFalse(String.includes(first.clientId)(found.body))
			// One code reads one sign-in: the other waiting one stays out of the answer, and an unknown code reads nothing.
			assert.deepStrictEqual(found.ids, [first.id])
			assert.deepStrictEqual((yield* lookup('BCDFGHJK')).ids, [])
			// A phone that opens the approve link signed out keeps the code through GitHub sign-in.
			assert.strictEqual(
				(yield* signIn(web.issuer, 'octocat', `?code=${first.id}`)).headers.get('location'),
				`/?code=${first.id}`
			)
			assert.strictEqual((yield* signIn(web.issuer, 'octocat')).headers.get('location'), '/')
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
				headers: {'content-type': 'application/json', cookie: session, origin: AUTH_URL},
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

	test.effect('streams a typed code until its sign-in expires and rejects decisions after expiry', () =>
		Effect.gen(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const request = yield* authorize(web.issuer, '', 'http://127.0.0.1:34567/callback', [
				'https://scope.mp281x.xyz/mcp'
			])
			const expirations = yield* pipe(
				send(web.issuer, `/events?code=${request.id}`, {headers: {cookie: session}}),
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
					headers: {'content-type': 'application/json', cookie: session, origin: AUTH_URL},
					method: 'POST'
				})).status,
				400
			)
		})
	)

	test.effect('accepts one decision across concurrent approving and denying sessions', () =>
		Effect.gen(function* () {
			const web = yield* servers()
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
						headers: {'content-type': 'application/json', cookie: decision.session, origin: AUTH_URL},
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
			const pending = yield* send(web.issuer, `/lookup?code=${request.id}`, {headers: {cookie: first}})
			assert.deepStrictEqual(
				yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(PendingAuthorization)))(
					yield* Effect.promise(() => pending.text())
				),
				[]
			)
		})
	)

	test.effect('returns a web sign-in to the page that started it only on its own domain, after any approve link', () =>
		Effect.gen(function* () {
			const web = yield* servers()
			const landing = Effect.fnUntraced(function* (search: Record<string, string>) {
				return (yield* signIn(
					web.issuer,
					'octocat',
					`?${UrlParams.toString(UrlParams.fromInput(search))}`
				)).headers.get('location')
			})
			assert.deepStrictEqual(
				[
					yield* landing({next: 'https://signal.mp281x.xyz/?invite=abc'}),
					yield* landing({next: 'https://evil.test/'}),
					yield* landing({next: 'http://signal.mp281x.xyz/'}),
					yield* landing({code: 'WDJB-MJHT', next: 'https://signal.mp281x.xyz/'}),
					yield* landing({})
				],
				['https://signal.mp281x.xyz/?invite=abc', '/', '/', '/?code=WDJB-MJHT', '/']
			)
		})
	)

	test.effect('returns a cancelled GitHub step to the sign-in it started from', () =>
		Effect.gen(function* () {
			const web = yield* servers()
			const start = yield* send(
				web.issuer,
				`/auth/github?${UrlParams.toString(UrlParams.fromInput({code: 'WDJB-MJHT'}))}`
			)
			const cancelled = yield* send(
				web.issuer,
				`/auth/github/callback?${UrlParams.toString(
					UrlParams.fromInput({
						error: 'access_denied',
						state: new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? ''
					})
				)}`,
				{headers: {cookie: cookie(start)}}
			)
			assert.strictEqual(cancelled.headers.get('location'), '/?error=github&code=WDJB-MJHT')
		})
	)

	test.effect('binds consent and one-use PKCE codes to the browser, client, callback and resources', () =>
		Effect.gen(function* () {
			const web = yield* servers()
			assert.strictEqual((yield* send(web.app, '/me')).status, 401)
			// Registration is public, so a client names only a few short callbacks.
			assert.strictEqual(
				(yield* send(web.issuer, '/api/auth/oauth2/register', {
					body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
						redirect_uris: Array.replicate('http://127.0.0.1:34567/callback', 5)
					}),
					headers: {'content-type': 'application/json'},
					method: 'POST'
				})).status,
				400
			)
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
			assert.strictEqual(
				(yield* send(web.issuer, '/auth/session', {headers: {cookie: cookie(yield* signIn(web.issuer, 'stranger'))}}))
					.status,
				401
			)
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
			assert.strictEqual(callback.searchParams.get('iss'), `${AUTH_URL}/api/auth`)
			assert.strictEqual(callback.searchParams.get('state'), 'example-state')
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
			const response = yield* exchange(web.issuer, request, code)
			const token = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => response.text())
			)
			assert.strictEqual(token.expires_in, 90_000)
			// The scheme is case-insensitive and may be followed by several spaces.
			assert.strictEqual(
				(yield* send(web.app, '/me', {headers: {authorization: `bearer  ${token.access_token}`}})).status,
				200
			)
			assert.strictEqual(
				(yield* send(web.issuer, '/auth/verify?resource=https://scope.mp281x.xyz/mcp', {
					headers: {authorization: `Bearer ${token.access_token}`}
				})).status,
				401
			)
			// A second redemption of the code revokes what the first one got.
			assert.strictEqual((yield* exchange(web.issuer, request, code)).status, 400)
			assert.strictEqual(
				(yield* send(web.app, '/me', {headers: {authorization: `Bearer ${token.access_token}`}})).status,
				401
			)
			assert.strictEqual((yield* refresh(web.issuer, request.clientId, token.refresh_token)).status, 400)
		})
	)

	test.effect('keeps clients that are signed in or waiting when public registrations fill the client list', () =>
		Effect.gen(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const request = yield* authorize(web.issuer, session, 'opm://auth/callback', [API])
			const granted = yield* exchange(
				web.issuer,
				request,
				(yield* consent(web.issuer, request, true)).searchParams.get('code') ?? ''
			)
			const token = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => granted.text())
			)
			const waiting = yield* authorize(web.issuer, session, 'trips://auth/callback', ['https://trips.mp281x.xyz'])
			yield* Effect.forEach(
				Array.range(1, 201),
				() =>
					send(web.issuer, '/api/auth/oauth2/register', {
						body: '{"redirect_uris":["http://127.0.0.1:1/callback"]}',
						headers: {'content-type': 'application/json'},
						method: 'POST'
					}),
				{concurrency: 1, discard: true}
			)
			assert.strictEqual((yield* refresh(web.issuer, request.clientId, token.refresh_token)).status, 200)
			// Its only callback stands in for a redirect_uri left out.
			assert.match(
				(yield* send(
					web.issuer,
					`/api/auth/oauth2/authorize?${UrlParams.toString(
						UrlParams.fromInput({
							client_id: request.clientId,
							code_challenge: 'x',
							code_challenge_method: 'S256',
							resource: API,
							response_type: 'code'
						})
					)}`
				)).headers.get('location') ?? '',
				/^\/\?request=/u
			)
			assert.strictEqual(
				(yield* exchange(
					web.issuer,
					waiting,
					(yield* consent(web.issuer, waiting, true)).searchParams.get('code') ?? ''
				)).status,
				200
			)
		})
	)

	test.effect('redeems a code once under concurrent exchanges and revokes what it gave', () =>
		Effect.gen(function* () {
			const web = yield* servers()
			const request = yield* authorize(
				web.issuer,
				cookie(yield* signIn(web.issuer, 'octocat')),
				'opm://auth/callback',
				[API]
			)
			const code = (yield* consent(web.issuer, request, true)).searchParams.get('code') ?? ''
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
			const winner = yield* Effect.fromOption(Array.findFirst(responses, response => response.status === 200))
			const token = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => winner.text())
			)
			assert.strictEqual(
				(yield* send(web.app, '/me', {headers: {authorization: `Bearer ${token.access_token}`}})).status,
				401
			)
		})
	)

	test.effect('accepts what OAuth 2.1 leaves optional and answers errors where the client listens', () =>
		Effect.gen(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const registered = yield* send(web.issuer, '/api/auth/oauth2/register', {
				body: yield* Schema.encodeEffect(Schema.fromJsonString(Registration))({
					client_name: 'codex',
					redirect_uris: ['http://127.0.0.1:1455/callback', 'http://[::1]:1455/callback']
				}),
				headers: {'content-type': 'application/json'},
				method: 'POST'
			})
			const registration = yield* Schema.decodeEffect(
				Schema.fromJsonString(Schema.Struct({client_id: Schema.String, client_name: Schema.String}))
			)(yield* Effect.promise(() => registered.text()))
			assert.strictEqual(registration.client_name, 'codex')
			const challenge = Base64Url.encode(
				yield* (yield* Digest.Digest).digest(Digest.sha256, new TextEncoder().encode(VERIFIER))
			)
			const start = Effect.fnUntraced(function* (search: Record<string, string>) {
				return yield* send(
					web.issuer,
					`/api/auth/oauth2/authorize?${UrlParams.toString(
						UrlParams.fromInput({
							client_id: registration.client_id,
							code_challenge: challenge,
							code_challenge_method: 'S256',
							redirect_uri: 'http://127.0.0.1:1455/callback',
							resource: 'https://scope.mp281x.xyz/mcp',
							response_type: 'code',
							...search
						})
					)}`
				)
			})
			const location = Effect.fnUntraced(function* (search: Record<string, string>) {
				return (yield* start(search)).headers.get('location') ?? ''
			})
			// A loopback callback may come back on another port, IPv6 too, and a request with an empty or no state still signs in.
			assert.deepStrictEqual(
				Array.map(
					[
						yield* location({redirect_uri: 'http://[::1]:61000/callback', state: ''}),
						yield* location({redirect_uri: 'http://127.0.0.1:61000/callback'})
					],
					String.startsWith('/?request=')
				),
				[true, true]
			)
			// Anything else in the callback must match as written.
			assert.deepStrictEqual(
				[
					(yield* start({redirect_uri: 'http://127.1:50123/callback'})).status,
					(yield* start({redirect_uri: 'http://127.0.0.1:50123/other/../callback'})).status,
					(yield* start({redirect_uri: ''})).status
				],
				[400, 400, 400]
			)
			const moved = yield* start({redirect_uri: 'http://127.0.0.1:50123/callback'})
			assert.strictEqual(moved.status, 302)
			const resources: Resource[] = ['https://scope.mp281x.xyz/mcp']
			const callback = yield* consent(
				web.issuer,
				{
					clientId: registration.client_id,
					cookie: `${session}; ${cookie(moved)}`,
					id: new URL(moved.headers.get('location') ?? '', AUTH_URL).searchParams.get('request') ?? '',
					redirect: 'http://127.0.0.1:50123/callback',
					resources
				},
				true
			)
			assert.strictEqual(callback.port, '50123')
			assert.isFalse(callback.searchParams.has('state'))
			const token = Effect.fnUntraced(function* (params: Record<string, string>) {
				return yield* send(web.issuer, '/api/auth/oauth2/token', {
					body: UrlParams.toString(UrlParams.fromInput(params)),
					headers: {'content-type': 'application/x-www-form-urlencoded'},
					method: 'POST'
				})
			})
			const code = {
				client_id: registration.client_id,
				code: callback.searchParams.get('code') ?? '',
				code_verifier: VERIFIER,
				grant_type: 'authorization_code'
			}
			// A sent redirect_uri must match; left out, as OAuth 2.1 allows, the code still redeems.
			assert.strictEqual((yield* token({...code, redirect_uri: 'http://127.0.0.1:9/elsewhere'})).status, 400)
			const granted = yield* token({...code, redirect_uri: ''})
			assert.strictEqual(granted.status, 200)
			const refreshToken = (yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => granted.text())
			)).refresh_token
			// A sent client_id must match; left out, a public client still refreshes.
			assert.deepStrictEqual(
				[
					(yield* token({client_id: 'another', grant_type: 'refresh_token', refresh_token: refreshToken})).status,
					(yield* token({grant_type: 'refresh_token', refresh_token: refreshToken})).status
				],
				[400, 200]
			)
			// Once the client and callback check out, a bad request returns to the callback with its state and issuer.
			const failed = new URL(yield* location({scope: 'admin', state: 'kept'}))
			assert.deepStrictEqual(
				[
					failed.origin,
					failed.searchParams.get('error'),
					failed.searchParams.get('state'),
					failed.searchParams.get('iss'),
					String.isNonEmpty(failed.searchParams.get('error_description') ?? '')
				],
				['http://127.0.0.1:1455', 'invalid_scope', 'kept', `${AUTH_URL}/api/auth`, true]
			)
			const returned = Effect.fnUntraced(function* (search: Record<string, string>) {
				return new URL(yield* location(search)).searchParams.get('error')
			})
			assert.deepStrictEqual(
				[
					yield* returned({response_type: 'token'}),
					yield* returned({response_type: ''}),
					yield* returned({resource: 'https://evil.test'})
				],
				['unsupported_response_type', 'invalid_request', 'invalid_target']
			)
			// An unknown client, a foreign callback or a left-out one among several never gets a redirect.
			assert.deepStrictEqual(
				[
					(yield* start({redirect_uri: 'http://evil.test/callback'})).status,
					(yield* send(
						web.issuer,
						`/api/auth/oauth2/authorize?${UrlParams.toString(
							UrlParams.fromInput({client_id: registration.client_id, response_type: 'code'})
						)}`
					)).status
				],
				[400, 400]
			)
			const unknown = yield* send(web.issuer, '/api/auth/oauth2/authorize?client_id=unknown')
			assert.strictEqual(unknown.status, 400)
			const errors = yield* Effect.forEach(
				[
					send(web.issuer, '/api/auth/oauth2/token', {
						body: 'grant_type=password',
						headers: {'content-type': 'application/x-www-form-urlencoded'},
						method: 'POST'
					}),
					send(web.issuer, '/api/auth/oauth2/register', {
						body: '{"redirect_uris":["https://evil.test/callback"]}',
						headers: {'content-type': 'application/json'},
						method: 'POST'
					}),
					send(web.issuer, '/api/auth/oauth2/register', {
						body: '{"redirect_uris":[]}',
						headers: {'content-type': 'application/json'},
						method: 'POST'
					}),
					Effect.succeed(unknown)
				],
				Effect.fnUntraced(function* (pending) {
					const response = yield* pending
					return (yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({error: Schema.String})))(
						yield* Effect.promise(() => response.text())
					)).error
				}),
				{concurrency: 1}
			)
			assert.deepStrictEqual(errors, [
				'unsupported_grant_type',
				'invalid_redirect_uri',
				'invalid_client_metadata',
				'invalid_client'
			])
		})
	)

	test.effect('rotates refresh tokens, revokes a reused or revoked family, and ends the session at sign-out', () =>
		Effect.gen(function* () {
			const web = yield* servers()
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
			yield* authorize(web.issuer, session, 'opm://auth/callback', [API])
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
				(yield* send(web.issuer, '/auth/sign-out', {headers: {cookie: session, origin: AUTH_URL}, method: 'POST'}))
					.status,
				204
			)
			assert.strictEqual((yield* send(web.issuer, '/me', {headers: {cookie: session}})).status, 401)
		})
	)

	test.effect('denies access without issuing a code and expires a code before exchange', () =>
		Effect.gen(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const denied = yield* consent(
				web.issuer,
				yield* authorize(web.issuer, session, 'http://localhost:34567/callback', ['https://scope.mp281x.xyz/mcp']),
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

	test.effect('lets an agent answer a waiting sign-in by its code as the browser does', () =>
		Effect.gen(function* () {
			const web = yield* servers()
			const token = yield* agentToken(web.issuer, cookie(yield* signIn(web.issuer, 'octocat')))
			const simulator = yield* authorize(web.issuer, '', 'opm-dev://auth/callback', [
				'https://opm.mp281x.xyz',
				'https://otel.mp281x.xyz'
			])
			const desktop = yield* authorize(web.issuer, '', 'http://127.0.0.1:34570/callback', [
				'https://scope.mp281x.xyz/mcp',
				APPROVALS
			])
			const release = yield* authorize(web.issuer, '', 'stash://auth/callback', [API, 'https://otel.mp281x.xyz'])
			assert.strictEqual(
				(yield* callTool(web.issuer, '', 'answer_request', {accept: true, request: simulator.id})).status,
				401
			)
			yield* Effect.forEach(
				[
					{accept: true, request: `${String.slice(0, 4)(simulator.id)}-${String.slice(4)(simulator.id)}`},
					{accept: true, request: desktop.id},
					{accept: false, request: String.toLowerCase(release.id)}
				],
				input => callTool(web.issuer, token, 'answer_request', input),
				{concurrency: 1, discard: true}
			)
			const callbacks = yield* Effect.forEach(
				[simulator, desktop, release],
				Effect.fnUntraced(function* (request) {
					const receiver = yield* send(web.issuer, `/auth/request?request=${request.id}`, {
						headers: {cookie: request.cookie}
					})
					const status = yield* Schema.decodeEffect(Schema.fromJsonString(AuthorizationStatus))(
						yield* Effect.promise(() => receiver.text())
					)
					if (status._tag !== 'Completed') return yield* Effect.die('Expected every sign-in to be answered')
					const params = new URL(status.url).searchParams
					return {code: params.get('code') ?? '', error: params.get('error') ?? ''}
				}),
				{concurrency: 1}
			)
			assert.deepStrictEqual(
				Array.map(callbacks, callback => [String.isNonEmpty(callback.code), callback.error]),
				[
					[true, ''],
					[true, ''],
					[false, 'access_denied']
				]
			)
			const signedIn = yield* exchange(web.issuer, simulator, callbacks[0]?.code ?? '')
			const access = (yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => signedIn.text())
			)).access_token
			const verified = yield* send(
				web.issuer,
				`/auth/verify?resource=${encodeURIComponent('https://opm.mp281x.xyz')}`,
				{headers: {authorization: `Bearer ${access}`}}
			)
			assert.deepStrictEqual(
				yield* Schema.decodeEffect(Schema.fromJsonString(User))(yield* Effect.promise(() => verified.text())),
				{id: 'github:42', name: 'octocat'}
			)
		})
	)

	test.effect('lets only an admin allow, decline and remove GitHub accounts, which sign them in and out', () =>
		Effect.gen(function* () {
			const web = yield* servers()
			const admin = yield* agentToken(web.issuer, cookie(yield* signIn(web.issuer, 'octocat')))
			const stranger = cookie(yield* signIn(web.issuer, 'stranger'))
			const drifter = cookie(yield* signIn(web.issuer, 'drifter'))
			const status = Effect.fnUntraced(function* (session: string) {
				return (yield* send(web.issuer, '/auth/session', {headers: {cookie: session}})).status
			})
			const text = Effect.fnUntraced(function* (response: Response) {
				return yield* Effect.promise(() => response.text())
			})
			assert.deepStrictEqual([yield* status(stranger), yield* status(drifter)], [401, 401])
			assert.deepStrictEqual(yield* people(web.issuer, admin), ['octocat:Admin', 'drifter:Waiting', 'stranger:Waiting'])
			yield* callTool(web.issuer, admin, 'answer_access_request', {allow: true, login: 'Stranger'})
			yield* callTool(web.issuer, admin, 'answer_access_request', {allow: false, login: 'drifter'})
			assert.deepStrictEqual([yield* status(stranger), yield* status(drifter)], [200, 401])
			assert.deepStrictEqual(yield* people(web.issuer, admin), ['octocat:Admin', 'stranger:Member'])
			const member = yield* agentToken(web.issuer, stranger)
			assert.isTrue(
				String.includes('Only an admin can manage people')(
					yield* text(yield* callTool(web.issuer, member, 'remove_person', {login: 'octocat'}))
				)
			)
			assert.isTrue(
				String.includes('cannot be removed here')(
					yield* text(yield* callTool(web.issuer, admin, 'remove_person', {login: 'octocat'}))
				)
			)
			yield* callTool(web.issuer, admin, 'remove_person', {login: 'stranger'})
			assert.strictEqual(yield* status(stranger), 401)
			assert.strictEqual(
				(yield* send(web.issuer, '/auth/verify?resource=https://auth.mp281x.xyz/mcp', {
					headers: {authorization: `Bearer ${member}`}
				})).status,
				401
			)
			assert.deepStrictEqual(yield* people(web.issuer, admin), ['octocat:Admin'])
		})
	)

	test.effect('lists each app an account signed in to by its last refresh and disconnects only its own', () =>
		Effect.gen(function* () {
			const web = yield* servers()
			const admin = cookie(yield* signIn(web.issuer, 'octocat'))
			const request = yield* authorize(web.issuer, admin, 'http://127.0.0.1:34567/callback', [
				'https://scope.mp281x.xyz/mcp'
			])
			const exchanged = yield* exchange(
				web.issuer,
				request,
				(yield* consent(web.issuer, request, true)).searchParams.get('code') ?? ''
			)
			const granted = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => exchanged.text())
			)
			const apps = Effect.fnUntraced(function* (session: string) {
				const response = yield* send(web.issuer, '/apps', {headers: {cookie: session}})
				return yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(SignedInApp)))(
					yield* Effect.promise(() => response.text())
				)
			})
			const signedIn = yield* apps(admin)
			assert.deepStrictEqual(
				Array.map(signedIn, app => [app.clientName, app.resources]),
				[['opencode', ['https://scope.mp281x.xyz/mcp']]]
			)
			yield* TestClock.adjust('1 hour')
			const rotated = yield* refresh(web.issuer, request.clientId, granted.refresh_token)
			const next = yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => rotated.text())
			)
			const refreshed = yield* apps(admin)
			assert.strictEqual(refreshed[0]?.lastActive, (signedIn[0]?.lastActive ?? 0) + 3_600_000)
			const family = refreshed[0]?.family ?? ''
			// Another account sees none of these and cannot disconnect them.
			const agent = yield* agentToken(web.issuer, admin)
			const stranger = cookie(yield* signIn(web.issuer, 'stranger'))
			yield* callTool(web.issuer, agent, 'answer_access_request', {allow: true, login: 'stranger'})
			assert.deepStrictEqual(yield* apps(stranger), [])
			assert.strictEqual(
				(yield* send(web.issuer, `/disconnect?family=${family}`, {headers: {cookie: stranger}, method: 'POST'})).status,
				400
			)
			assert.strictEqual(
				(yield* send(web.issuer, `/disconnect?family=${family}`, {headers: {cookie: admin}, method: 'POST'})).status,
				204
			)
			// The agent's own sign-in stays; the disconnected app has to sign in again.
			assert.deepStrictEqual(
				Array.map(yield* apps(admin), app => app.resources),
				[['https://auth.mp281x.xyz/mcp']]
			)
			assert.strictEqual((yield* refresh(web.issuer, request.clientId, next.refresh_token)).status, 400)
		})
	)
})
