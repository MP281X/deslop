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
import {RateLimiter} from 'effect/persistence'
import {TestClock} from 'effect/testing'

import type {Resource} from '@deslop/runtime/auth/schema'
import {AuthError, ClientRegistration, TokenResponse, User} from '@deslop/runtime/auth/schema'
import {Auth, HttpAuth} from '@deslop/runtime/auth/service'
import {AUTH_URL, CurrentUser} from '@deslop/runtime/auth/utils'

import {HttpHandlers} from '#http/handlers.ts'
import {GitHub} from '#services/github/service.ts'
import {AdmitParams, Person, PersonParams} from '#services/people/schema.ts'
import {People} from '#services/people/service.ts'
import {
	AnswerParams,
	AuthorizationStatus,
	CodeParams,
	PendingAuthorization,
	RequestParams
} from '#services/sign-ins/schema.ts'
import {SignIns} from '#services/sign-ins/service.ts'
import {FamilyParams, Registration, SignedInApp} from '#services/tokens/schema.ts'
import {Tokens, layerStore} from '#services/tokens/service.ts'
import {layerMcp} from '#tools/handlers.ts'

const API = 'https://stash.mp281x.xyz'
const APPROVALS = 'https://auth.mp281x.xyz/mcp'
const GITHUB_IDS: Record<string, number> = {drifter: 9, octocat: 42, stranger: 7}
const IPHONE_SAFARI =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const VERIFIER = String.repeat(43)('x')

const me = pipe(
	HttpRouter.add('GET', '/me', Effect.flatMap(CurrentUser, HttpServerResponse.schemaJson(User))),
	Layer.provide(HttpAuth.layer)
)

// A test route answers a refusal with its message, as the page shows it.
function refused<E, R>(handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) {
	return Effect.catchIf(handler, Schema.is(AuthError), failure =>
		Effect.succeed(HttpServerResponse.text(failure.message, {status: 400}))
	)
}

const servers = Effect.fnUntraced(function* (home?: string) {
	const directory = home ?? (yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped())
	const digest = yield* Digest.Digest
	const clock = yield* Clock.Clock
	const ready = yield* Queue.make<true>()
	const github = HttpClient.make(request =>
		Effect.gen(function* () {
			if (
				!String.startsWith('https://github.com/')(request.url) &&
				!String.startsWith('https://api.github.com/')(request.url)
			) {
				return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
			}
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
						HttpHandlers,
						layerMcp,
						// What the waiting page's watch reads first.
						HttpRouter.add(
							'GET',
							'/auth/request',
							pipe(
								Effect.gen(function* () {
									const params = yield* HttpServerRequest.schemaSearchParams(RequestParams)
									return yield* HttpServerResponse.schemaJson(AuthorizationStatus)(
										yield* Effect.flatMap(
											Stream.runHead(
												(yield* SignIns).status(params.request, (yield* HttpServerRequest.HttpServerRequest).headers)
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
								// The People page's RPCs.
								HttpRouter.add(
									'GET',
									'/people',
									pipe(
										Effect.gen(function* () {
											return yield* HttpServerResponse.schemaJson(Schema.Array(Person))(
												yield* (yield* People).list(yield* CurrentUser)
											)
										}),
										refused
									)
								),
								HttpRouter.add(
									'POST',
									'/admit',
									pipe(
										Effect.gen(function* () {
											const input = yield* HttpServerRequest.schemaBodyJson(AdmitParams)
											yield* (yield* People).admit(input, yield* CurrentUser)
											return HttpServerResponse.empty()
										}),
										refused
									)
								),
								HttpRouter.add(
									'POST',
									'/remove-person',
									pipe(
										Effect.gen(function* () {
											const input = yield* HttpServerRequest.schemaBodyJson(PersonParams)
											yield* (yield* People).remove(input.id, yield* CurrentUser)
											return HttpServerResponse.empty()
										}),
										refused
									)
								),
								HttpRouter.add(
									'GET',
									'/apps',
									Effect.gen(function* () {
										return yield* HttpServerResponse.schemaJson(Schema.Array(SignedInApp))(
											yield* Effect.flatMap(Stream.runHead((yield* Tokens).apps(yield* CurrentUser)), Effect.fromOption)
										)
									})
								),
								HttpRouter.add(
									'POST',
									'/disconnect',
									pipe(
										Effect.gen(function* () {
											const params = yield* HttpServerRequest.schemaSearchParams(FamilyParams)
											yield* (yield* Tokens).disconnect(params.family, yield* CurrentUser)
											return HttpServerResponse.empty()
										}),
										Effect.catchTag('AuthError', () => Effect.succeed(HttpServerResponse.empty({status: 400})))
									)
								),
								// The page's `auth.answer` RPC.
								HttpRouter.add(
									'POST',
									'/answer',
									pipe(
										Effect.gen(function* () {
											const input = yield* HttpServerRequest.schemaBodyJson(AnswerParams)
											yield* (yield* SignIns).answer(input, yield* CurrentUser, 'Session')
											return HttpServerResponse.empty()
										}),
										refused
									)
								),
								HttpRouter.add(
									'GET',
									'/lookup',
									Effect.gen(function* () {
										const params = yield* HttpServerRequest.schemaSearchParams(CodeParams)
										return yield* HttpServerResponse.schemaJson(Schema.Array(PendingAuthorization))(
											Option.toArray(
												yield* Effect.flatMap(Stream.runHead((yield* SignIns).lookup(params.code)), Effect.fromOption)
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
												(yield* SignIns).lookup(params.code),
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
					Layer.provideMerge(Layer.mergeAll(SignIns.layer, RateLimiter.layer)),
					Layer.provideMerge(People.layer),
					Layer.provideMerge(Layer.mergeAll(Tokens.layer, GitHub.layer, RateLimiter.layerStoreMemory)),
					Layer.provide(layerStore),
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

// An approval as the page sends it, by the signed-in session in `session`.
const answer = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	session: string,
	request: string,
	accept: boolean
) {
	return yield* send(web, '/answer', {
		body: yield* Schema.encodeEffect(Schema.fromJsonString(AnswerParams))({accept, request}),
		headers: {'content-type': 'application/json', cookie: session},
		method: 'POST'
	})
})

// The answer, delivered to the browser or command that holds the sign-in's cookie.
const delivered = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	request: {cookie: string; id: string}
) {
	const response = yield* send(web, `/auth/continue?request=${request.id}`, {headers: {cookie: request.cookie}})
	assert.strictEqual(response.status, 302)
	return new URL(response.headers.get('location') ?? '', AUTH_URL)
})

const consent = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	request: Effect.Success<ReturnType<typeof authorize>>,
	accept: boolean
) {
	assert.strictEqual((yield* answer(web, request.cookie, request.id, accept)).status, 204)
	return yield* delivered(web, request)
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
	code: string,
	forwardedFor = '93.184.216.34'
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
		headers: {'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': forwardedFor},
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

// A JSON body, posted by the signed-in session in `session`.
const post = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	path: string,
	session: string,
	body: unknown
) {
	return yield* send(web, path, {
		body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(body),
		headers: {'content-type': 'application/json', cookie: session},
		method: 'POST'
	})
})

const people = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	session: string
) {
	const response = yield* send(web, '/people', {headers: {cookie: session}})
	return Array.map(
		yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Person)))(
			yield* Effect.promise(() => response.text())
		),
		person => `${person.name}:${person.role}`
	)
})

it.layer(Layer.merge(NodeCrypto.layer, NodeServices.layer))(test => {
	test.effect(
		'keeps sessions, rotated tokens and revocations across restarts',
		Effect.fnUntraced(function* () {
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

	test.effect(
		'starts over the previous release’s storage and deletes it',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const home = yield* fs.makeTempDirectoryScoped()
			const directory = `${home}/.deslop/auth`
			yield* fs.makeDirectory(directory, {recursive: true})
			// The shape an earlier release saved, which this one cannot read.
			yield* fs.writeFileString(`${directory}/state`, '{"members":[],"tokens":{}}')
			assert.strictEqual((yield* signIn((yield* servers(home)).issuer, 'octocat')).status, 302)
			assert.isFalse(yield* fs.exists(`${directory}/state`))
		})
	)

	test.effect(
		'approves from a separate session while only the originating browser receives the callback',
		Effect.fnUntraced(function* () {
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
			assert.strictEqual((yield* answer(web.issuer, session, first.id, true)).status, 204)
			const decided = yield* send(web.issuer, `/auth/request?request=${first.id}`, {
				headers: {cookie: `${first.cookie}; ${second.cookie}`}
			})
			assert.deepStrictEqual(
				yield* Schema.decodeEffect(Schema.fromJsonString(AuthorizationStatus))(
					yield* Effect.promise(() => decided.text())
				),
				{_tag: 'Decided'}
			)
			// Only the browser holding the sign-in's cookie collects the answer, and only once.
			assert.strictEqual(
				(yield* send(web.issuer, `/auth/continue?request=${first.id}`, {headers: {cookie: session}})).status,
				400
			)
			const callback = yield* delivered(web.issuer, {cookie: `${first.cookie}; ${second.cookie}`, id: first.id})
			assert.strictEqual(callback.origin, 'http://127.0.0.1:34567')
			assert.strictEqual(
				(yield* send(web.issuer, `/auth/continue?request=${first.id}`, {headers: {cookie: first.cookie}})).status,
				400
			)
			assert.strictEqual((yield* exchange(web.issuer, first, callback.searchParams.get('code') ?? '')).status, 200)
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

	test.effect(
		'streams a typed code until its sign-in expires and rejects decisions after expiry',
		Effect.fnUntraced(function* () {
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
			yield* TestClock.adjust('601 seconds')
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
			assert.strictEqual((yield* answer(web.issuer, session, request.id, true)).status, 400)
		})
	)

	test.effect(
		'accepts one decision across concurrent approving and denying sessions',
		Effect.fnUntraced(function* () {
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
				decision => answer(web.issuer, decision.session, request.id, decision.accept),
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

	test.effect(
		'returns a web sign-in to the page that started it only on its own domain, after any approve link',
		Effect.fnUntraced(function* () {
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

	test.effect(
		'returns a cancelled GitHub step to the sign-in it started from',
		Effect.fnUntraced(function* () {
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

	test.effect(
		'binds consent and one-use PKCE codes to the browser, client, callback and resources',
		Effect.fnUntraced(function* () {
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

	test.effect(
		'answers 429 past an address’s budget per minute and accepts it again after the window',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const register = Effect.fnUntraced(function* (forwardedFor: string) {
				return yield* send(web.issuer, '/api/auth/oauth2/register', {
					body: '{"redirect_uris":["http://127.0.0.1:1/callback"]}',
					headers: {'content-type': 'application/json', 'x-forwarded-for': forwardedFor},
					method: 'POST'
				})
			})
			const statuses = yield* Effect.forEach(
				Array.range(1, 11),
				() => Effect.map(register('2001:db8:1:2::1'), response => response.status),
				{concurrency: 1}
			)
			assert.deepStrictEqual(Array.dedupe(Array.take(statuses, 10)), [201])
			// Another address in the same IPv6 /64 shares the budget; an address elsewhere does not.
			const limited = yield* register('2001:db8:1:2::ffff')
			assert.deepStrictEqual(
				[statuses[10], limited.status, String.isNonEmpty(limited.headers.get('retry-after') ?? '')],
				[429, 429, true]
			)
			assert.strictEqual((yield* register('2001:db8:9::1')).status, 201)
			yield* TestClock.adjust('61 seconds')
			assert.strictEqual((yield* register('2001:db8:1:2::1')).status, 201)
		})
	)

	test.effect(
		'redirects a request without redirect_uri to the client’s only callback',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const request = yield* authorize(
				web.issuer,
				cookie(yield* signIn(web.issuer, 'octocat')),
				'opm://auth/callback',
				[API]
			)
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
					request,
					(yield* consent(web.issuer, request, true)).searchParams.get('code') ?? ''
				)).status,
				200
			)
		})
	)

	test.effect(
		'redeems a code once under concurrent exchanges and revokes what it gave',
		Effect.fnUntraced(function* () {
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

	test.effect(
		'accepts what OAuth 2.1 leaves optional and answers errors where the client listens',
		Effect.fnUntraced(function* () {
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

	test.effect(
		'rotates refresh tokens, revokes a reused or revoked family, and ends the session at sign-out',
		Effect.fnUntraced(function* () {
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
			// The family is the public prefix of every bearer, so it alone revokes nothing and proves no replay.
			const family = String.split(token.access_token, '.')[0] ?? ''
			assert.strictEqual(
				(yield* send(web.issuer, '/api/auth/oauth2/revoke', {
					body: UrlParams.toString(
						UrlParams.fromInput({client_id: request.clientId, token: `${family}.${String.repeat(43)('A')}`})
					),
					headers: {'content-type': 'application/x-www-form-urlencoded'},
					method: 'POST'
				})).status,
				204
			)
			assert.strictEqual(
				(yield* refresh(web.issuer, request.clientId, `${family}.0.${String.repeat(43)('A')}`)).status,
				400
			)
			assert.strictEqual(
				(yield* send(web.issuer, '/auth/verify?resource=https://scope.mp281x.xyz/mcp', {
					headers: {authorization: `Bearer ${rotated.access_token}`}
				})).status,
				200
			)
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

	test.effect(
		'denies access without issuing a code and expires a code before exchange',
		Effect.fnUntraced(function* () {
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

	test.effect(
		'lets an agent answer a waiting sign-in by its code as the browser does',
		Effect.fnUntraced(function* () {
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
					const params = (yield* delivered(web.issuer, request)).searchParams
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

	test.effect(
		'lets only an admin allow, decline and remove GitHub accounts, which sign them in and out',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const admin = cookie(yield* signIn(web.issuer, 'octocat'))
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
			yield* post(web.issuer, '/admit', admin, {allow: true, id: 'github:7'})
			yield* post(web.issuer, '/admit', admin, {allow: false, id: 'github:9'})
			assert.deepStrictEqual([yield* status(stranger), yield* status(drifter)], [200, 401])
			assert.deepStrictEqual(yield* people(web.issuer, admin), ['octocat:Admin', 'stranger:Member'])
			const member = yield* agentToken(web.issuer, stranger)
			assert.isTrue(
				String.includes('Only an admin can manage people')(
					yield* text(yield* post(web.issuer, '/remove-person', stranger, {id: 'github:42'}))
				)
			)
			assert.isTrue(
				String.includes('cannot be removed here')(
					yield* text(yield* post(web.issuer, '/remove-person', admin, {id: 'github:42'}))
				)
			)
			yield* post(web.issuer, '/remove-person', admin, {id: 'github:7'})
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

	test.effect(
		'lists each app an account signed in to by its last refresh and disconnects only its own',
		Effect.fnUntraced(function* () {
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
			// The account's browsers are listed too; these checks read its apps.
			const apps = Effect.fnUntraced(function* (session: string) {
				const response = yield* send(web.issuer, '/apps', {headers: {cookie: session}})
				return Array.filter(
					yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(SignedInApp)))(
						yield* Effect.promise(() => response.text())
					),
					app => app.kind === 'App'
				)
			})
			const signedIn = yield* apps(admin)
			assert.deepStrictEqual(
				Array.map(signedIn, app => [app.client, app.device, app.resources]),
				[['Opencode', '93.184.216.34', ['https://scope.mp281x.xyz/mcp']]]
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
			yield* post(web.issuer, '/admit', admin, {allow: true, id: 'github:7'})
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
			assert.strictEqual(
				(yield* send(web.issuer, '/auth/verify?resource=https://auth.mp281x.xyz/mcp', {
					headers: {authorization: `Bearer ${agent}`}
				})).status,
				200
			)
			assert.strictEqual((yield* refresh(web.issuer, request.clientId, next.refresh_token)).status, 400)
		})
	)

	test.effect(
		'replaces a sign-in of the same client and apps from the same address, and keeps one from elsewhere',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const admin = cookie(yield* signIn(web.issuer, 'octocat'))
			const signInFrom = Effect.fnUntraced(function* (forwardedFor: string) {
				const request = yield* authorize(web.issuer, admin, 'http://127.0.0.1:34567/callback', [
					'https://scope.mp281x.xyz/mcp'
				])
				const exchanged = yield* exchange(
					web.issuer,
					request,
					(yield* consent(web.issuer, request, true)).searchParams.get('code') ?? '',
					forwardedFor
				)
				return {
					clientId: request.clientId,
					tokens: yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
						yield* Effect.promise(() => exchanged.text())
					)
				}
			})
			const apps = Effect.flatMap(send(web.issuer, '/apps', {headers: {cookie: admin}}), response =>
				Effect.map(
					Effect.flatMap(
						Effect.promise(() => response.text()),
						Schema.decodeEffect(Schema.fromJsonString(Schema.Array(SignedInApp)))
					),
					Array.filter(app => app.kind === 'App')
				)
			)
			// Traefik appends the connecting address last; the entry before it is whatever the client sent.
			const first = yield* signInFrom('1.1.1.1, 93.184.216.34')
			yield* signInFrom('93.184.216.34')
			assert.strictEqual((yield* apps).length, 1)
			assert.strictEqual((yield* refresh(web.issuer, first.clientId, first.tokens.refresh_token)).status, 400)
			yield* signInFrom('1.1.1.1')
			assert.deepStrictEqual(
				Array.sort(
					Array.map(yield* apps, app => app.device),
					String.Order
				),
				['1.1.1.1', '93.184.216.34']
			)
			// A worker's private address reads as the worker.
			yield* signInFrom('100.68.201.107')
			assert.isTrue(Array.some(yield* apps, app => app.device === 'dev'))
		})
	)

	test.effect(
		'signs a browser in with a code another device approves and returns it to its page on this domain',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const admin = cookie(yield* signIn(web.issuer, 'octocat'))
			const token = yield* agentToken(web.issuer, admin)
			const start = Effect.fnUntraced(function* (next: string) {
				const started = yield* send(web.issuer, `/auth/code?${UrlParams.toString(UrlParams.fromInput({next}))}`, {
					headers: {'user-agent': IPHONE_SAFARI}
				})
				return {
					cookie: cookie(started),
					id: new URL(started.headers.get('location') ?? '', AUTH_URL).searchParams.get('request') ?? ''
				}
			})
			const browser = yield* start('https://signal.mp281x.xyz/world')
			const waiting = yield* send(web.issuer, `/auth/request?request=${browser.id}`, {
				headers: {cookie: browser.cookie}
			})
			const status = yield* Schema.decodeEffect(Schema.fromJsonString(AuthorizationStatus))(
				yield* Effect.promise(() => waiting.text())
			)
			if (status._tag !== 'Waiting') return yield* Effect.die('Expected a waiting browser sign-in')
			assert.deepStrictEqual(
				[status.request.kind, status.request.clientName, status.request.device, status.request.resources],
				['Browser', 'Safari', 'iPhone', []]
			)
			// A session in a browser grants every app, so an agent's token cannot approve one.
			const byAgent = yield* callTool(web.issuer, token, 'answer_request', {accept: true, request: browser.id})
			assert.isTrue(String.includes('only from a signed-in browser')(yield* Effect.promise(() => byAgent.text())))
			assert.strictEqual((yield* answer(web.issuer, admin, browser.id, true)).status, 204)
			const signedIn = yield* send(web.issuer, `/auth/continue?request=${browser.id}`, {
				headers: {cookie: browser.cookie}
			})
			assert.strictEqual(signedIn.headers.get('location'), 'https://signal.mp281x.xyz/world')
			assert.strictEqual((yield* send(web.issuer, '/auth/session', {headers: {cookie: cookie(signedIn)}})).status, 200)
			// A code may have been approved for another person's browser, so its session lasts 30 days, not a year.
			assert.isTrue(
				Array.some(
					signedIn.headers.getSetCookie(),
					value => String.startsWith('__Secure-session=')(value) && String.includes('Max-Age=2592000')(value)
				)
			)
			// The approved browser is listed among the account's sign-ins, and signing it out there ends its session.
			const listed = yield* send(web.issuer, '/apps', {headers: {cookie: admin}})
			const browserApp = yield* Effect.fromOption(
				Array.findFirst(
					yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(SignedInApp)))(
						yield* Effect.promise(() => listed.text())
					),
					app => app.client === 'Safari' && app.device === 'iPhone'
				)
			)
			assert.strictEqual(
				(yield* send(web.issuer, `/disconnect?family=${browserApp.family}`, {headers: {cookie: admin}, method: 'POST'}))
					.status,
				204
			)
			assert.strictEqual((yield* send(web.issuer, '/auth/session', {headers: {cookie: cookie(signedIn)}})).status, 401)
			// An approver removed before delivery delivers a denial.
			const stranger = cookie(yield* signIn(web.issuer, 'stranger'))
			yield* post(web.issuer, '/admit', admin, {allow: true, id: 'github:7'})
			const late = yield* start('https://signal.mp281x.xyz/world')
			assert.strictEqual((yield* answer(web.issuer, stranger, late.id, true)).status, 204)
			yield* post(web.issuer, '/remove-person', admin, {id: 'github:7'})
			const declined = yield* send(web.issuer, `/auth/continue?request=${late.id}`, {headers: {cookie: late.cookie}})
			assert.strictEqual(declined.headers.get('location'), '/')
			assert.isFalse(String.includes('__Secure-session=')(cookie(declined)))
			// A page elsewhere is dropped, and a denied browser gets no session.
			const elsewhere = yield* start('https://evil.test/')
			assert.strictEqual((yield* answer(web.issuer, admin, elsewhere.id, false)).status, 204)
			const denied = yield* send(web.issuer, `/auth/continue?request=${elsewhere.id}`, {
				headers: {cookie: elsewhere.cookie}
			})
			assert.strictEqual(denied.headers.get('location'), '/')
			assert.isFalse(String.includes('__Secure-session=')(cookie(denied)))
		})
	)

	test.effect(
		'delivers a command’s sign-in to its loopback callback once approved, answering 408 while it waits',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const command = yield* authorize(web.issuer, '', 'http://127.0.0.1:34571/callback', [APPROVALS])
			const early = yield* Effect.forkScoped(
				send(web.issuer, `/auth/continue?request=${command.id}`, {headers: {cookie: command.cookie}})
			)
			yield* TestClock.adjust('50 seconds')
			assert.strictEqual((yield* Fiber.join(early)).status, 408)
			const waiting = yield* Effect.forkScoped(delivered(web.issuer, command))
			assert.strictEqual((yield* answer(web.issuer, session, command.id, true)).status, 204)
			const callback = yield* Fiber.join(waiting)
			assert.strictEqual(`${callback.origin}${callback.pathname}`, 'http://127.0.0.1:34571/callback')
			assert.strictEqual((yield* exchange(web.issuer, command, callback.searchParams.get('code') ?? '')).status, 200)
		})
	)
})
