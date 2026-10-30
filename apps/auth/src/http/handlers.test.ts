import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	Clock,
	ConfigProvider,
	Effect,
	FileSystem,
	Fiber,
	Layer,
	MutableList,
	MutableHashMap,
	Option,
	Order,
	Queue,
	Ref,
	Schema,
	String,
	Stream,
	pipe
} from 'effect'

import {McpSchema, McpServer} from 'effect/ai'
import {Digest} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {
	FetchHttpClient,
	HttpClient,
	HttpClientResponse,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
	UrlParams
} from 'effect/http'
import {TestClock} from 'effect/testing'

import type {Resource} from '@deslop/runtime/auth/schema'
import {ClientRegistration, TokenResponse, User} from '@deslop/runtime/auth/schema'
import {Auth, HttpAuth} from '@deslop/runtime/auth/service'
import {AUTH_URL, CurrentUser} from '@deslop/runtime/auth/utils'

import {HttpHandlers} from '#http/handlers.ts'
import {Changes} from '#services/changes/service.ts'
import {AddServer, ConnectionInfo, ServerParams} from '#services/connections/schema.ts'
import {Connections} from '#services/connections/service.ts'
import {Gateway} from '#services/gateway/service.ts'
import {GitHub} from '#services/github/service.ts'
import {Members, Person} from '#services/people/schema.ts'
import {People} from '#services/people/service.ts'
import {
	AnswerParams,
	AuthorizationStatus,
	CodeParams,
	PendingAuthorization,
	RequestParams
} from '#services/sign-ins/schema.ts'
import {SignIns} from '#services/sign-ins/service.ts'
import {FamilyParams, Registration, SignedInApp, TokenState} from '#services/tokens/schema.ts'
import {Tokens, layerStore} from '#services/tokens/service.ts'
import {layerMcp} from '#tools/handlers.ts'

const API = 'https://stash.mp281x.xyz'
const APPROVALS = 'https://auth.mp281x.xyz/mcp'
const GITHUB_IDS: Record<string, number> = {drifter: 9, octocat: 42, stranger: 7}
const PROVIDERS = {
	dual: {
		issuer: 'https://app.dualos.ai',
		metadata: 'https://app.dualos.ai/.well-known/oauth-authorization-server',
		url: 'https://app.dualos.ai/mcp'
	},
	mobbin: {
		issuer: 'https://ujasntkfphywizsdaapi.supabase.co/auth/v1',
		metadata: 'https://ujasntkfphywizsdaapi.supabase.co/auth/v1/.well-known/oauth-authorization-server',
		url: 'https://api.mobbin.com/mcp'
	}
}
const VERIFIER = String.repeat(43)('x')

function discoveryResponse(url: string) {
	if (url === 'https://challenge.example.com/resource-info') {
		return Response.json({
			authorization_servers: ['https://identity.example.com'],
			resource: 'https://challenge.example.com/mcp'
		})
	}
	if (!String.includes('/.well-known/')(url)) return undefined
	if (String.includes('challenge.example.com')(url)) return new Response(undefined, {status: 404})
	if (String.includes('identity.example.com')(url)) {
		return Response.json({
			authorization_endpoint: 'https://identity.example.com/oauth/authorize',
			client_id_metadata_document_supported: true,
			issuer: 'https://identity.example.com',
			response_types_supported: ['code'],
			token_endpoint: 'https://identity.example.com/oauth/token'
		})
	}
	if (String.includes('public.example.com')(url)) return new Response(undefined, {status: 404})
	if (String.includes('oauth-protected-resource')(url)) {
		return Response.json({
			authorization_servers: [
				Boolean.match(new URL(url).origin === 'https://app.dualos.ai', {
					onFalse: () => PROVIDERS.mobbin.issuer,
					onTrue: () => PROVIDERS.dual.issuer
				})
			],
			resource: `${new URL(url).origin}/mcp`,
			scopes_supported: ['openid']
		})
	}
	return Response.json({
		authorization_endpoint: `${PROVIDERS.mobbin.issuer}/oauth/authorize`,
		authorization_response_iss_parameter_supported: true,
		issuer: PROVIDERS.mobbin.issuer,
		registration_endpoint: `${PROVIDERS.mobbin.issuer}/oauth/clients/register`,
		response_types_supported: ['code'],
		token_endpoint: `${PROVIDERS.mobbin.issuer}/oauth/token`
	})
}

const me = pipe(
	HttpRouter.add('GET', '/me', Effect.flatMap(CurrentUser, HttpServerResponse.schemaJson(User))),
	Layer.provide(HttpAuth.layer)
)

function getUpstream(url: string) {
	if (url === 'https://challenge.example.com/mcp') {
		return new Response(undefined, {
			headers: {
				'www-authenticate': 'Bearer resource_metadata="https://challenge.example.com/resource-info", scope="items:read"'
			},
			status: 401
		})
	}
	return new Response(undefined, {status: 405})
}

function upstreamHttpResponse(request: Request) {
	const metadata = discoveryResponse(request.url)
	if (metadata !== undefined) return metadata
	if (request.method === 'GET') return new Response(undefined, {status: 405})
	if (request.url === 'https://challenge.example.com/mcp') return getUpstream(request.url)
	return undefined
}

const servers = Effect.fnUntraced(function* (home?: string) {
	const directory = home ?? (yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped())
	const digest = yield* Digest.Digest
	const clock = yield* Clock.Clock
	const ready = yield* Queue.make<true>()
	const rejectAccess = yield* Ref.make('never')
	const pauseReject = yield* Ref.make(false)
	const rejectReady = yield* Queue.make<true>()
	const rejectContinue = yield* Queue.make<true>()
	const toolNames = yield* Ref.make(['search'])
	const stall = yield* Ref.make(false)
	const stallReady = yield* Queue.make<true>()
	const upstreamRequests = MutableList.make<{url: string; method: string; authorization: string; body: unknown}>()
	const grants = MutableList.make<{grant: string; refresh: string; resource: string}>()
	const sessions = MutableHashMap.empty<string, string>()
	const rejected = Effect.gen(function* () {
		if (yield* Ref.get(pauseReject)) {
			yield* Queue.offer(rejectReady, true)
			yield* Queue.take(rejectContinue)
		}
		return new Response(undefined, {status: 401})
	})
	function fetchUpstream(input: RequestInfo | URL, init?: RequestInit) {
		const request = new Request(input, init)
		// oxlint-disable-next-line no-restricted-properties -- The MCP SDK's FetchLike contract requires a Promise<Response>.
		return Effect.runPromise(
			Effect.gen(function* () {
				const metadata = upstreamHttpResponse(request)
				if (metadata !== undefined) return metadata
				if (request.method === 'DELETE') {
					MutableHashMap.remove(sessions, request.headers.get('mcp-session-id') ?? '')
					return new Response(undefined, {status: 204})
				}
				const body = yield* Effect.promise(() => request.json())
				const message = yield* Schema.decodeUnknownEffect(
					Schema.Struct({
						id: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.String])),
						method: Schema.String,
						params: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown))
					})
				)(body)
				const authorization = request.headers.get('authorization') ?? ''
				MutableList.append(upstreamRequests, {authorization, body, method: message.method, url: request.url})
				if (new URL(request.url).hostname === 'api.mobbin.com' && (yield* Ref.get(stall))) {
					yield* Queue.offer(stallReady, true)
					return yield* Effect.never
				}
				if (authorization === (yield* Ref.get(rejectAccess))) return yield* rejected
				if (message.method === 'server/discover') {
					return Response.json(
						{error: {code: -32_601, message: 'Not found'}, id: message.id, jsonrpc: '2.0'},
						{status: 400}
					)
				}
				if (message.method === 'initialize') {
					const session = `session-${upstreamRequests.length}`
					MutableHashMap.set(sessions, session, authorization)
					return Response.json(
						{
							id: message.id,
							jsonrpc: '2.0',
							result: {
								capabilities: {tools: {}},
								protocolVersion: '2025-06-18',
								serverInfo: {name: 'legacy-provider', version: '1'}
							}
						},
						{headers: {'mcp-session-id': session}}
					)
				}
				if (
					!Option.contains(MutableHashMap.get(sessions, request.headers.get('mcp-session-id') ?? ''), authorization)
				) {
					return new Response(undefined, {status: 404})
				}
				if (message.method === 'notifications/initialized') return new Response(undefined, {status: 202})
				if (message.method === 'tools/list') {
					return Response.json({
						id: message.id,
						jsonrpc: '2.0',
						result: {
							tools: Array.map(yield* Ref.get(toolNames), name => ({
								annotations: {readOnlyHint: true},
								description: 'Search example',
								inputSchema: {properties: {query: {type: 'string'}}, required: ['query'], type: 'object'},
								name
							}))
						}
					})
				}
				return Response.json({
					id: message.id,
					jsonrpc: '2.0',
					result: {
						content: [
							{text: 'search result', type: 'text'},
							{data: 'aGVsbG8=', mimeType: 'image/png', type: 'image'}
						],
						isError:
							message.params?.['arguments'] !== undefined &&
							Schema.is(Schema.Struct({query: Schema.Literal('fail')}))(message.params['arguments']),
						structuredContent: {query: message.params?.['arguments']}
					}
				})
			}),
			{signal: request.signal}
		)
	}
	const provider = HttpClient.make(request =>
		Effect.sync(() => {
			if (request.url === PROVIDERS.mobbin.metadata || request.url === PROVIDERS.dual.metadata) {
				return HttpClientResponse.fromWeb(
					request,
					Response.json({
						authorization_endpoint: `${PROVIDERS.mobbin.issuer}/oauth/authorize`,
						authorization_response_iss_parameter_supported: true,
						issuer: PROVIDERS.mobbin.issuer,
						registration_endpoint: `${PROVIDERS.mobbin.issuer}/oauth/clients/register`,
						token_endpoint: `${PROVIDERS.mobbin.issuer}/oauth/token`
					})
				)
			}
			if (String.endsWith('/oauth/clients/register')(request.url)) {
				return HttpClientResponse.fromWeb(request, Response.json({client_id: 'gateway-client'}))
			}
			if (String.endsWith('/oauth/token')(request.url) && request.body._tag === 'Uint8Array') {
				const form = new URLSearchParams(new TextDecoder().decode(request.body.body))
				MutableList.append(grants, {
					grant: form.get('grant_type') ?? '',
					refresh: form.get('refresh_token') ?? '',
					resource: form.get('resource') ?? ''
				})
				if (form.get('code') === 'no-refresh') {
					return HttpClientResponse.fromWeb(
						request,
						Response.json({access_token: 'another-account', expires_in: 30, token_type: 'Bearer'})
					)
				}
				return HttpClientResponse.fromWeb(
					request,
					Response.json({
						access_token: `upstream-${form.get('grant_type') ?? ''}-${grants.length}`,
						expires_in: 60,
						refresh_token: `refresh-${form.get('grant_type') ?? ''}-${grants.length}`,
						token_type: 'Bearer'
					})
				)
			}
			return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
		})
	)
	const github = HttpClient.make(request =>
		Effect.gen(function* () {
			if (
				!String.startsWith('https://github.com/')(request.url) &&
				!String.startsWith('https://api.github.com/')(request.url)
			) {
				return yield* provider.execute(request)
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
						pipe(
							HttpRouter.add(
								'GET',
								'/registry',
								Effect.gen(function* () {
									return HttpServerResponse.jsonUnsafe(
										Array.map((yield* McpServer.McpServer).tools, entry => entry.tool.name)
									)
								})
							),
							Layer.provide(McpServer.McpServer.layer)
						),
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
								HttpRouter.add(
									'GET',
									'/server-events',
									Effect.gen(function* () {
										return HttpServerResponse.stream(
											pipe(
												(yield* Connections).watch(yield* CurrentUser),
												Stream.take(2),
												Stream.mapEffect((snapshot, index) =>
													Effect.gen(function* () {
														if (index === 0) yield* Queue.offer(ready, true)
														return new TextEncoder().encode(
															`${yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Array(ConnectionInfo)))(snapshot)}\n`
														)
													})
												)
											)
										)
									})
								),
								HttpRouter.add(
									'POST',
									'/servers/remove',
									pipe(
										Effect.gen(function* () {
											const input = yield* HttpServerRequest.schemaBodyJson(ServerParams)
											yield* (yield* Connections).remove(input.id, yield* CurrentUser)
											return HttpServerResponse.empty()
										}),
										Effect.catchTag('AuthError', () => Effect.succeed(HttpServerResponse.empty({status: 400})))
									)
								),
								HttpRouter.add(
									'POST',
									'/servers',
									pipe(
										Effect.gen(function* () {
											const input = yield* HttpServerRequest.schemaBodyJson(AddServer)
											return yield* HttpServerResponse.schemaJson(ConnectionInfo)(
												yield* (yield* Connections).add(input.url, yield* CurrentUser)
											)
										}),
										Effect.catchTag('AuthError', () => Effect.succeed(HttpServerResponse.empty({status: 400})))
									)
								),
								HttpRouter.add(
									'GET',
									'/servers',
									Effect.gen(function* () {
										return yield* HttpServerResponse.schemaJson(Schema.Array(ConnectionInfo))(
											yield* Effect.flatMap(
												Stream.runHead((yield* Connections).watch(yield* CurrentUser)),
												Effect.fromOption
											)
										)
									})
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
											yield* (yield* SignIns).answer(input, yield* CurrentUser)
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
					Layer.provideMerge(Layer.merge(Gateway.layer, SignIns.layer)),
					Layer.provideMerge(Connections.layer),
					Layer.provideMerge(People.layer),
					Layer.provideMerge(Layer.merge(Tokens.layer, GitHub.layer)),
					Layer.provideMerge(Changes.layer),
					Layer.provide(layerStore),
					Layer.provide(
						Layer.mergeAll(
							NodeCrypto.layer,
							NodeServices.layer,
							Layer.succeed(HttpClient.HttpClient, github),
							Layer.succeed(FetchHttpClient.Fetch, fetchUpstream),
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
	return {
		app,
		grants,
		issuer,
		pauseReject,
		ready,
		rejectAccess,
		rejectContinue,
		rejectReady,
		sessions,
		stall,
		stallReady,
		toolNames,
		upstreamRequests
	}
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

const addMcp = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	session: string,
	url: string
) {
	const response = yield* send(web, '/servers', {
		body: yield* Schema.encodeEffect(Schema.fromJsonString(AddServer))({url}),
		headers: {'content-type': 'application/json', cookie: session},
		method: 'POST'
	})
	assert.strictEqual(response.status, 200)
	return yield* Schema.decodeEffect(Schema.fromJsonString(ConnectionInfo))(yield* Effect.promise(() => response.text()))
})

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
	forwardedFor = '203.0.113.7'
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

const modern = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['issuer'],
	token: string,
	method: string,
	params: Record<string, unknown> = {}
) {
	return yield* send(web, '/mcp', {
		body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
			id: 1,
			jsonrpc: '2.0',
			method,
			params: {
				...params,
				_meta: {
					'io.modelcontextprotocol/clientCapabilities': {},
					'io.modelcontextprotocol/clientInfo': {name: 'codex', version: '1'},
					'io.modelcontextprotocol/protocolVersion': '2026-07-28'
				}
			}
		}),
		headers: {
			accept: 'application/json, text/event-stream',
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
			'mcp-method': method,
			'mcp-protocol-version': '2026-07-28',
			...Option.match(Option.fromUndefinedOr(params['name']), {
				onNone: () => ({}),
				onSome: name => ({'mcp-name': Schema.decodeUnknownSync(Schema.String)(name)})
			})
		},
		method: 'POST'
	})
})

it.layer(Layer.merge(NodeCrypto.layer, NodeServices.layer))(test => {
	test.effect(
		'discovers challenge-only metadata and authorizes with a client metadata document',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const added = yield* addMcp(web.issuer, session, 'https://challenge.example.com/mcp')
			assert.isFalse(added.connected)
			const start = yield* send(web.issuer, `/auth/mcp/connect?id=${added.id}`, {headers: {cookie: session}})
			const target = new URL(start.headers.get('location') ?? '')
			assert.strictEqual(target.searchParams.get('client_id'), `${AUTH_URL}/auth/mcp/client.json`)
			assert.strictEqual(target.searchParams.get('scope'), 'items:read')
			const callback = yield* send(
				web.issuer,
				`/auth/mcp/callback?${new URLSearchParams({code: 'approved', iss: 'https://identity.example.com', state: target.searchParams.get('state') ?? ''})}`,
				{headers: {cookie: `${session}; ${cookie(start)}`}}
			)
			assert.strictEqual(callback.headers.get('location'), '/mcp-servers')
			assert.strictEqual(web.grants.length, 1)
		})
	)
	test.effect(
		'encodes unsafe tool names and physically removes vanished and removed registrations',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const token = yield* agentToken(web.issuer, session)
			const added = yield* addMcp(web.issuer, session, 'https://public.example.com/mcp')
			yield* Ref.set(web.toolNames, ['search.docs', 'search_docs', 'search__encoded_literal'])
			const listed = yield* modern(web.issuer, token, 'tools/list')
			const names = Array.map(
				(yield* Schema.decodeEffect(
					Schema.fromJsonString(Schema.Struct({result: Schema.Struct({tools: Schema.Array(McpSchema.Tool)})}))
				)(yield* Effect.promise(() => listed.text()))).result.tools,
				tool => tool.name
			)
			const remote = Array.filter(names, String.startsWith(`${added.id}__`))
			assert.strictEqual(remote.length, 3)
			assert.strictEqual(Array.dedupe(remote).length, 3)
			for (const name of remote) assert.match(name, /^[a-zA-Z0-9_-]{1,64}$/u)
			const encoded = yield* Effect.fromOption(
				Array.findFirst(remote, String.startsWith(`${added.id}__search_docs__encoded_`))
			)
			yield* modern(web.issuer, token, 'tools/call', {arguments: {query: 'dotted'}, name: encoded})
			assert.isTrue(
				Array.some(MutableList.toArray(web.upstreamRequests), request =>
					Schema.is(
						Schema.Struct({
							method: Schema.Literal('tools/call'),
							params: Schema.Struct({name: Schema.Literal('search.docs')})
						})
					)(request.body)
				)
			)
			yield* Ref.set(web.toolNames, ['search_docs'])
			yield* modern(web.issuer, token, 'tools/list')
			const sendResponse = yield* send(web.issuer, '/registry')
			assert.deepStrictEqual(
				Array.filter(
					yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Schema.String)))(
						yield* Effect.promise(() => sendResponse.text())
					),
					String.startsWith(`${added.id}__`)
				),
				[`${added.id}__search_docs`]
			)
			yield* send(web.issuer, '/servers/remove', {
				body: yield* Schema.encodeEffect(Schema.fromJsonString(ServerParams))({id: added.id}),
				headers: {'content-type': 'application/json', cookie: session},
				method: 'POST'
			})
			yield* modern(web.issuer, token, 'tools/list')
			const removed = yield* send(web.issuer, '/registry')
			assert.isFalse(String.includes(`${added.id}__`)(yield* Effect.promise(() => removed.text())))
		})
	)
	test.effect(
		'never retries an old URL with a removed and replaced connection’s credentials',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const token = yield* agentToken(web.issuer, session)
			yield* addMcp(web.issuer, session, PROVIDERS.mobbin.url)
			const connect = Effect.fnUntraced(function* () {
				const start = yield* send(web.issuer, '/auth/mcp/connect?id=mobbin', {headers: {cookie: session}})
				yield* send(
					web.issuer,
					`/auth/mcp/callback?${new URLSearchParams({code: 'approved', iss: PROVIDERS.mobbin.issuer, state: new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? ''})}`,
					{headers: {cookie: `${session}; ${cookie(start)}`}}
				)
			})
			yield* connect()
			yield* modern(web.issuer, token, 'tools/list')
			yield* Ref.set(web.rejectAccess, 'Bearer upstream-authorization_code-1')
			yield* Ref.set(web.pauseReject, true)
			const pending = yield* Effect.forkScoped(
				modern(web.issuer, token, 'tools/call', {arguments: {query: 'racing'}, name: 'mobbin__search'})
			)
			yield* Queue.take(web.rejectReady)
			yield* send(web.issuer, '/servers/remove', {
				body: yield* Schema.encodeEffect(Schema.fromJsonString(ServerParams))({id: 'mobbin'}),
				headers: {'content-type': 'application/json', cookie: session},
				method: 'POST'
			})
			assert.strictEqual((yield* addMcp(web.issuer, session, 'https://app.mobbin.net/mcp')).id, 'mobbin')
			yield* connect()
			yield* Queue.offer(web.rejectContinue, true)
			const response = yield* Fiber.join(pending)
			assert.isTrue(String.includes('isError')(yield* Effect.promise(() => response.text())))
			assert.isFalse(
				Array.some(
					MutableList.toArray(web.upstreamRequests),
					request =>
						request.url === PROVIDERS.mobbin.url && request.authorization === 'Bearer upstream-authorization_code-2'
				)
			)
			assert.strictEqual(web.grants.length, 2)
		})
	)
	test.effect(
		'adds arbitrary MCP URLs without a catalog and isolates removed and re-added servers',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const initial = yield* send(web.issuer, '/servers', {headers: {cookie: session}})
			assert.deepStrictEqual(
				yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(ConnectionInfo)))(
					yield* Effect.promise(() => initial.text())
				),
				[]
			)
			const publicServer = yield* addMcp(web.issuer, session, 'https://public.example.com/mcp')
			assert.isTrue(publicServer.connected)
			assert.strictEqual(publicServer.tools, 1)
			assert.strictEqual(MutableHashMap.size(web.sessions), 0)
			const external = yield* addMcp(web.issuer, session, 'https://mcp.example.com/mcp')
			const collision = yield* addMcp(web.issuer, session, 'https://mcp.example.net/mcp')
			assert.strictEqual(external.id, 'example')
			assert.match(collision.id, /^example_[a-z0-9_-]{6}$/u)
			assert.isFalse(external.connected)
			const token = yield* agentToken(web.issuer, session)
			const before = yield* modern(web.issuer, token, 'tools/list')
			const beforeText = yield* Effect.promise(() => before.text())
			assert.isTrue(String.includes(`${publicServer.id}__search`)(beforeText))
			assert.isFalse(String.includes('example__search')(beforeText))
			assert.strictEqual(
				(yield* send(web.issuer, '/servers/remove', {
					body: yield* Schema.encodeEffect(Schema.fromJsonString(ServerParams))({id: publicServer.id}),
					headers: {'content-type': 'application/json', cookie: session},
					method: 'POST'
				})).status,
				204
			)
			assert.strictEqual((yield* addMcp(web.issuer, session, publicServer.url)).id, publicServer.id)
			const previousRequests = MutableList.toArray(web.upstreamRequests)
			const stale = yield* modern(web.issuer, token, 'tools/call', {
				arguments: {query: 'stale definition'},
				name: `${publicServer.id}__search`
			})
			assert.isTrue(String.includes('error')(yield* Effect.promise(() => stale.text())))
			assert.deepStrictEqual(MutableList.toArray(web.upstreamRequests), previousRequests)
			yield* modern(web.issuer, token, 'tools/list')
			const called = yield* modern(web.issuer, token, 'tools/call', {
				arguments: {query: 'new definition'},
				name: `${publicServer.id}__search`
			})
			assert.isTrue(String.includes('new definition')(yield* Effect.promise(() => called.text())))
			assert.strictEqual(
				(yield* send(web.issuer, '/servers', {
					body: yield* Schema.encodeEffect(Schema.fromJsonString(AddServer))({url: publicServer.url}),
					headers: {'content-type': 'application/json', cookie: session},
					method: 'POST'
				})).status,
				400
			)
			const stranger = cookie(yield* signIn(web.issuer, 'stranger'))
			yield* callTool(web.issuer, token, 'answer_access_request', {allow: true, login: 'stranger'})
			assert.strictEqual(
				(yield* send(web.issuer, '/servers', {
					body: yield* Schema.encodeEffect(Schema.fromJsonString(AddServer))({url: 'https://another.example.com/mcp'}),
					headers: {'content-type': 'application/json', cookie: stranger},
					method: 'POST'
				})).status,
				400
			)
			const snapshot = yield* send(web.issuer, '/servers', {headers: {cookie: session}})
			const snapshotText = yield* Effect.promise(() => snapshot.text())
			assert.isFalse(String.includes('access_token')(snapshotText))
			assert.isFalse(String.includes('refresh_token')(snapshotText))
			assert.strictEqual(MutableHashMap.size(web.sessions), 0)
		})
	)
	test.effect(
		'shares provider authorization across harnesses and restarts while bridging stateless calls to legacy sessions',
		Effect.fnUntraced(function* () {
			const home = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const saved = yield* Effect.scoped(
				Effect.gen(function* () {
					const web = yield* servers(home)
					const session = cookie(yield* signIn(web.issuer, 'octocat'))
					const token = yield* agentToken(web.issuer, session)
					assert.strictEqual((yield* modern(web.issuer, '', 'tools/list')).status, 401)
					assert.strictEqual(web.upstreamRequests.length, 0)
					yield* addMcp(web.issuer, session, PROVIDERS.mobbin.url)
					yield* addMcp(web.issuer, session, 'https://stash.mp281x.xyz/mcp')
					const start = yield* send(web.issuer, '/auth/mcp/connect?id=mobbin', {headers: {cookie: session}})
					const target = new URL(start.headers.get('location') ?? '')
					assert.strictEqual(target.searchParams.get('code_challenge_method'), 'S256')
					assert.strictEqual(target.searchParams.get('resource'), PROVIDERS.mobbin.url)
					const callback = `/auth/mcp/callback?${new URLSearchParams({code: 'provider-code', iss: PROVIDERS.mobbin.issuer, state: target.searchParams.get('state') ?? ''})}`
					assert.strictEqual(
						(yield* send(web.issuer, callback, {headers: {cookie: session}})).headers.get('location'),
						'/mcp-servers'
					)
					assert.strictEqual(web.grants.length, 0)
					assert.strictEqual(
						(yield* send(web.issuer, callback, {headers: {cookie: `${session}; ${cookie(start)}`}})).status,
						302
					)
					assert.strictEqual(
						(yield* send(web.issuer, callback, {headers: {cookie: `${session}; ${cookie(start)}`}})).status,
						302
					)
					assert.strictEqual(web.grants.length, 1)
					const listed = yield* modern(web.issuer, token, 'tools/list')
					assert.strictEqual(listed.status, 200)
					const tools = (yield* Schema.decodeEffect(
						Schema.fromJsonString(Schema.Struct({result: Schema.Struct({tools: Schema.Array(McpSchema.Tool)})}))
					)(yield* Effect.promise(() => listed.text()))).result.tools
					assert.isTrue(
						Array.some(tools, tool => tool.name === 'mobbin__search' && tool.annotations?.readOnlyHint === true)
					)
					assert.isTrue(Array.some(tools, tool => tool.name === 'stash__search'))
					const result = yield* modern(web.issuer, token, 'tools/call', {
						arguments: {query: 'onboarding'},
						name: 'mobbin__search'
					})
					const text = yield* Effect.promise(() => result.text())
					assert.isTrue(String.includes('aGVsbG8=')(text))
					assert.isTrue(String.includes('onboarding')(text))
					assert.isFalse(String.includes('upstream-')(text))
					assert.isFalse(String.includes('refresh-')(text))
					assert.strictEqual((yield* callTool(web.issuer, token, 'mobbin__search', {query: 'claude'})).status, 200)
					assert.strictEqual(MutableHashMap.size(web.sessions), 0)
					const own = yield* Effect.fromOption(
						Array.findFirst(
							MutableList.toArray(web.upstreamRequests),
							request => request.url === 'https://stash.mp281x.xyz/mcp'
						)
					)
					assert.notStrictEqual(own.authorization, `Bearer ${token}`)
					assert.strictEqual(
						(yield* send(web.issuer, '/auth/verify?resource=https://stash.mp281x.xyz/mcp', {
							headers: {authorization: own.authorization}
						})).status,
						200
					)
					assert.strictEqual(
						(yield* send(web.issuer, '/auth/verify?resource=https://scope.mp281x.xyz/mcp', {
							headers: {authorization: own.authorization}
						})).status,
						401
					)
					assert.deepStrictEqual(MutableList.toArray(web.grants), [
						{grant: 'authorization_code', refresh: '', resource: PROVIDERS.mobbin.url}
					])
					return {session, token}
				})
			)
			const web = yield* servers(home)
			const secondRequest = yield* authorize(web.issuer, saved.session, 'http://127.0.0.1:9876/callback', [APPROVALS])
			const second = yield* exchange(
				web.issuer,
				secondRequest,
				(yield* consent(web.issuer, secondRequest, true)).searchParams.get('code') ?? '',
				'203.0.113.99'
			)
			const secondToken = (yield* Schema.decodeEffect(Schema.fromJsonString(TokenResponse))(
				yield* Effect.promise(() => second.text())
			)).access_token
			yield* modern(web.issuer, secondToken, 'tools/list')
			assert.strictEqual(web.grants.length, 0)
			assert.strictEqual(
				(yield* modern(web.issuer, saved.token, 'tools/call', {
					arguments: {query: 'original machine'},
					name: 'mobbin__search'
				})).status,
				200
			)
			yield* TestClock.adjust('40 seconds')
			const toolError = yield* modern(web.issuer, secondToken, 'tools/call', {
				arguments: {query: 'fail'},
				name: 'mobbin__search'
			})
			assert.isTrue(
				(yield* Schema.decodeEffect(
					Schema.fromJsonString(Schema.Struct({result: Schema.Struct({isError: Schema.Boolean})}))
				)(yield* Effect.promise(() => toolError.text()))).result.isError
			)
			assert.deepStrictEqual(MutableList.toArray(web.grants), [
				{grant: 'refresh_token', refresh: 'refresh-authorization_code-1', resource: PROVIDERS.mobbin.url}
			])
			yield* Ref.set(web.rejectAccess, 'Bearer upstream-refresh_token-1')
			yield* Effect.all(
				[modern(web.issuer, saved.token, 'tools/list'), modern(web.issuer, secondToken, 'tools/list')],
				{concurrency: 'unbounded'}
			)
			assert.deepStrictEqual(MutableList.toArray(web.grants), [
				{grant: 'refresh_token', refresh: 'refresh-authorization_code-1', resource: PROVIDERS.mobbin.url},
				{grant: 'refresh_token', refresh: 'refresh-refresh_token-1', resource: PROVIDERS.mobbin.url}
			])
			yield* Ref.set(web.stall, true)
			const slowList = yield* Effect.forkScoped(modern(web.issuer, secondToken, 'tools/list'))
			yield* Queue.take(web.stallReady)
			yield* TestClock.adjust('2 seconds')
			const partial = yield* Fiber.join(slowList)
			const partialText = yield* Effect.promise(() => partial.text())
			assert.isTrue(String.includes('connect_mcp')(partialText))
			assert.isTrue(String.includes('stash__search')(partialText))
			assert.strictEqual((yield* modern(web.issuer, saved.token, 'tools/list')).status, 200)
			yield* callTool(web.issuer, secondToken, 'disconnect_mcp', {id: 'mobbin'})
			const disconnected = yield* modern(web.issuer, saved.token, 'tools/call', {
				arguments: {query: 'blocked'},
				name: 'mobbin__search'
			})
			yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({error: Schema.Struct({code: Schema.Int})})))(
				yield* Effect.promise(() => disconnected.text())
			)
			const listed = yield* modern(web.issuer, secondToken, 'tools/list')
			assert.isFalse(String.includes('mobbin__search')(yield* Effect.promise(() => listed.text())))
			yield* Ref.set(web.stall, false)
			yield* TestClock.adjust('21 seconds')
			assert.strictEqual(MutableHashMap.size(web.sessions), 0)
		})
	)

	test.effect(
		'does not retain the previous account’s refresh token when a new authorization omits one',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const session = cookie(yield* signIn(web.issuer, 'octocat'))
			const token = yield* agentToken(web.issuer, session)
			yield* addMcp(web.issuer, session, PROVIDERS.mobbin.url)
			for (const code of ['provider-code', 'no-refresh']) {
				const start = yield* send(web.issuer, '/auth/mcp/connect?id=mobbin', {headers: {cookie: session}})
				assert.strictEqual(
					(yield* send(
						web.issuer,
						`/auth/mcp/callback?${new URLSearchParams({code, iss: PROVIDERS.mobbin.issuer, state: new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? ''})}`,
						{headers: {cookie: `${session}; ${cookie(start)}`}}
					)).status,
					302
				)
			}
			yield* modern(web.issuer, token, 'tools/list')
			const shortLived = yield* modern(web.issuer, token, 'tools/call', {
				arguments: {query: 'still valid'},
				name: 'mobbin__search'
			})
			assert.isTrue(String.includes('still valid')(yield* Effect.promise(() => shortLived.text())))
			const requestsBeforeExpiry = MutableList.toArray(web.upstreamRequests)
			const updates = yield* pipe(
				send(web.issuer, '/server-events', {headers: {cookie: session}}),
				Effect.flatMap(response => Effect.promise(() => response.text())),
				Effect.forkScoped
			)
			yield* Queue.take(web.ready)
			yield* TestClock.adjust('31 seconds')
			assert.deepStrictEqual(
				yield* Effect.forEach(
					pipe(yield* Fiber.join(updates), String.trim, String.split('\n')),
					line =>
						pipe(
							Schema.decodeEffect(Schema.fromJsonString(Schema.Array(ConnectionInfo)))(line),
							Effect.map(snapshot => Array.map(snapshot, server => server.status))
						),
					{concurrency: 1}
				),
				[['Connected'], ['Expired']]
			)
			yield* modern(web.issuer, token, 'tools/list')
			assert.deepStrictEqual(
				Array.map(MutableList.toArray(web.grants), grant => grant.grant),
				['authorization_code', 'authorization_code']
			)
			assert.deepStrictEqual(MutableList.toArray(web.upstreamRequests), requestsBeforeExpiry)
		})
	)

	test.effect(
		'rejects provider callbacks from another issuer and non-admin connection management',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const admin = cookie(yield* signIn(web.issuer, 'octocat'))
			const token = yield* agentToken(web.issuer, admin)
			const stranger = cookie(yield* signIn(web.issuer, 'stranger'))
			yield* callTool(web.issuer, token, 'answer_access_request', {allow: true, login: 'stranger'})
			yield* addMcp(web.issuer, admin, PROVIDERS.mobbin.url)
			assert.strictEqual(
				(yield* send(web.issuer, '/auth/mcp/connect?id=mobbin', {headers: {cookie: stranger}})).headers.get('location'),
				'/mcp-servers'
			)
			const start = yield* send(web.issuer, '/auth/mcp/connect?id=mobbin', {headers: {cookie: admin}})

			const params = new URLSearchParams({
				code: 'attacker-code',
				iss: 'https://evil.test',
				state: new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? ''
			})
			assert.strictEqual(
				(yield* send(web.issuer, `/auth/mcp/callback?${params}`, {headers: {cookie: `${admin}; ${cookie(start)}`}}))
					.status,
				302
			)
			assert.strictEqual(web.grants.length, 0)
			// The MCP page names why the connection failed.
			const listed = yield* send(web.issuer, '/servers', {headers: {cookie: admin}})
			assert.deepStrictEqual(
				Array.map(
					yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(ConnectionInfo)))(
						yield* Effect.promise(() => listed.text())
					),
					server => server.error
				),
				['The answer came from another authorization server']
			)
			params.set('iss', PROVIDERS.mobbin.issuer)
			assert.strictEqual(
				(yield* send(web.issuer, `/auth/mcp/callback?${params}`, {headers: {cookie: `${admin}; ${cookie(start)}`}}))
					.status,
				302
			)
			assert.strictEqual(web.grants.length, 0)
			// A provider cannot redirect metadata discovery to a different issuer.
			assert.strictEqual(
				(yield* send(web.issuer, '/servers', {
					body: yield* Schema.encodeEffect(Schema.fromJsonString(AddServer))({url: PROVIDERS.dual.url}),
					headers: {'content-type': 'application/json', cookie: admin},
					method: 'POST'
				})).status,
				400
			)
		})
	)
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
		'keeps clients that are signed in or waiting when public registrations fill the client list',
		Effect.fnUntraced(function* () {
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
				Effect.flatMap(
					Effect.promise(() => response.text()),
					Schema.decodeEffect(Schema.fromJsonString(Schema.Array(SignedInApp)))
				)
			)
			// Traefik appends the connecting address last; the entry before it is whatever the client sent.
			const first = yield* signInFrom('198.51.100.1, 203.0.113.7')
			yield* signInFrom('203.0.113.7')
			assert.strictEqual((yield* apps).length, 1)
			assert.strictEqual((yield* refresh(web.issuer, first.clientId, first.tokens.refresh_token)).status, 400)
			yield* signInFrom('198.51.100.1')
			assert.strictEqual((yield* apps).length, 2)
		})
	)

	test.effect(
		'signs a browser in with a code another device approves and returns it to its page on this domain',
		Effect.fnUntraced(function* () {
			const web = yield* servers()
			const admin = cookie(yield* signIn(web.issuer, 'octocat'))
			const token = yield* agentToken(web.issuer, admin)
			const start = Effect.fnUntraced(function* (next: string) {
				const started = yield* send(web.issuer, `/auth/code?${UrlParams.toString(UrlParams.fromInput({next}))}`)
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
			assert.deepStrictEqual([status.request.kind, status.request.resources], ['Browser', []])
			yield* callTool(web.issuer, token, 'answer_request', {accept: true, request: browser.id})
			const signedIn = yield* send(web.issuer, `/auth/continue?request=${browser.id}`, {
				headers: {cookie: browser.cookie}
			})
			assert.strictEqual(signedIn.headers.get('location'), 'https://signal.mp281x.xyz/world')
			assert.strictEqual((yield* send(web.issuer, '/auth/session', {headers: {cookie: cookie(signedIn)}})).status, 200)
			// The approved browser is listed among the account's sign-ins, and signing it out there ends its session.
			const listed = yield* send(web.issuer, '/apps', {headers: {cookie: admin}})
			const browserApp = yield* Effect.fromOption(
				Array.findFirst(
					yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(SignedInApp)))(
						yield* Effect.promise(() => listed.text())
					),
					app => String.startsWith('Browser (')(app.clientName)
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
			yield* callTool(web.issuer, token, 'answer_access_request', {allow: true, login: 'stranger'})
			const late = yield* start('https://signal.mp281x.xyz/world')
			assert.strictEqual((yield* answer(web.issuer, stranger, late.id, true)).status, 204)
			yield* callTool(web.issuer, token, 'remove_person', {login: 'stranger'})
			const refused = yield* send(web.issuer, `/auth/continue?request=${late.id}`, {headers: {cookie: late.cookie}})
			assert.strictEqual(refused.headers.get('location'), '/')
			assert.isFalse(String.includes('__Secure-session=')(cookie(refused)))
			// A page elsewhere is dropped, and a denied browser gets no session.
			const elsewhere = yield* start('https://evil.test/')
			yield* callTool(web.issuer, token, 'answer_request', {accept: false, request: elsewhere.id})
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
			yield* TestClock.withLive(Effect.sleep('100 millis'))
			yield* TestClock.adjust('50 seconds')
			assert.strictEqual((yield* Fiber.join(early)).status, 408)
			const waiting = yield* Effect.forkScoped(delivered(web.issuer, command))
			yield* TestClock.withLive(Effect.sleep('100 millis'))
			assert.strictEqual((yield* answer(web.issuer, session, command.id, true)).status, 204)
			const callback = yield* Fiber.join(waiting)
			assert.strictEqual(`${callback.origin}${callback.pathname}`, 'http://127.0.0.1:34571/callback')
			assert.strictEqual((yield* exchange(web.issuer, command, callback.searchParams.get('code') ?? '')).status, 200)
		})
	)

	test.effect(
		'keeps the members and sign-ins the previous release saved in one value',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const home = yield* fs.makeTempDirectoryScoped()
			const directory = `${home}/.deslop/auth`
			const session = yield* Effect.scoped(
				Effect.gen(function* () {
					return cookie(yield* signIn((yield* servers(home)).issuer, 'octocat'))
				})
			)
			const hashed = Effect.fnUntraced(function* (value: string) {
				return Base64Url.encode(yield* (yield* Digest.Digest).digest(Digest.sha256, new TextEncoder().encode(value)))
			})
			const user = {id: 'github:42', name: 'octocat'}
			yield* fs.writeFileString(
				`${directory}/state`,
				yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
					members: yield* Schema.decodeEffect(Schema.fromJsonString(Members))(
						yield* fs.readFileString(`${directory}/members`)
					),
					// The previous release's shapes: a harness whose refresh token names no client, and entries that no longer live here.
					tokens: {
						...(yield* Schema.decodeEffect(Schema.fromJsonString(TokenState))(
							yield* fs.readFileString(`${directory}/tokens`)
						)),
						[yield* hashed('legacy-client')]: {
							expiresAt: 4e15,
							payload: {_tag: 'Client', name: 'Old harness', redirects: ['http://127.0.0.1:1/callback']}
						},
						[yield* hashed('legacy-refresh')]: {
							expiresAt: 4e15,
							payload: {_tag: 'Refresh', clientId: 'legacy-client', family: 'legacy', resources: [APPROVALS], user}
						},
						code: {
							expiresAt: 4e15,
							payload: {
								_tag: 'Code',
								challenge: 'x',
								clientId: 'legacy-client',
								redirectUri: 'http://127.0.0.1:1/callback',
								resources: [APPROVALS],
								user
							}
						},
						delivered: {expiresAt: 4e15, payload: {_tag: 'Delivered', id: 'WDJBMJHT', url: 'http://127.0.0.1:1/'}},
						login: {expiresAt: 4e15, payload: {_tag: 'Login', verifier: 'x'}},
						waiting: {expiresAt: 4e15, payload: {_tag: 'Request', id: 'WDJBMJHT'}}
					}
				})
			)
			yield* fs.remove(`${directory}/members`)
			yield* fs.remove(`${directory}/tokens`)
			const web = yield* servers(home)
			assert.strictEqual((yield* send(web.issuer, '/auth/session', {headers: {cookie: session}})).status, 200)
			assert.isFalse(yield* fs.exists(`${directory}/state`))
			assert.strictEqual((yield* refresh(web.issuer, 'legacy-client', 'legacy-refresh')).status, 200)
			const apps = yield* send(web.issuer, '/apps', {headers: {cookie: session}})
			assert.deepStrictEqual(
				Array.map(
					yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(SignedInApp)))(
						yield* Effect.promise(() => apps.text())
					),
					app => app.clientName
				),
				['Old harness']
			)
		})
	)
})
