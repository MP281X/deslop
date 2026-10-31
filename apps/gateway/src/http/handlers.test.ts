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
	MutableHashMap,
	MutableList,
	Option,
	Queue,
	Ref,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {McpSchema} from 'effect/ai'
import {
	Cookies,
	FetchHttpClient,
	HttpClient,
	HttpClientResponse,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse
} from 'effect/http'
import {TestClock} from 'effect/testing'

import {AuthError} from '@deslop/runtime/auth/schema'
import type {User} from '@deslop/runtime/auth/schema'
import {Auth, HttpAuth} from '@deslop/runtime/auth/service'
import {AUTH_URL, CurrentUser} from '@deslop/runtime/auth/utils'

import {HttpHandlers} from '#http/handlers.ts'
import {GATEWAY_URL} from '#services/connections/lib/utils.ts'
import {AddServer, ConnectionInfo, ServerParams, ToolVisibility} from '#services/connections/schema.ts'
import {Connections} from '#services/connections/service.ts'
import {Gateway} from '#services/gateway/service.ts'
import {layerMcp} from '#tools/handlers.ts'

const ACCOUNTS: Record<string, User> = {
	octocat: {id: 'github:42', name: 'octocat'},
	stranger: {id: 'github:7', name: 'stranger'}
}
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
// A session cookie or agent token names its account; Auth itself is tested in its own app.
const SESSION = 'session=octocat'
const TOKEN = 'agent-octocat'

function discoveryResponse(url: string) {
	if (url === 'https://challenge.example.com/resource-info') {
		return Response.json({
			authorization_servers: ['https://identity.example.com'],
			resource: 'https://challenge.example.com/mcp'
		})
	}
	if (!String.includes('/.well-known/')(url)) return undefined
	// A Deslop MCP names Auth as its authorization server, as `@deslop/runtime` serves it.
	if (url === 'https://stash.mp281x.xyz/.well-known/oauth-protected-resource/mcp') {
		return Response.json({
			authorization_servers: [`${AUTH_URL}/api/auth`],
			resource: 'https://stash.mp281x.xyz/mcp',
			scopes_supported: ['deslop']
		})
	}
	if (url === `${AUTH_URL}/.well-known/oauth-authorization-server/api/auth`) {
		return Response.json({
			authorization_endpoint: `${AUTH_URL}/api/auth/oauth2/authorize`,
			authorization_response_iss_parameter_supported: true,
			issuer: `${AUTH_URL}/api/auth`,
			registration_endpoint: `${AUTH_URL}/api/auth/oauth2/register`,
			response_types_supported: ['code'],
			token_endpoint: `${AUTH_URL}/api/auth/oauth2/token`
		})
	}
	if (String.startsWith(AUTH_URL)(url)) return new Response(undefined, {status: 404})
	// A provider that neither registers clients nor names itself in its answers.
	if (String.includes('silent.example.com')(url)) {
		if (String.includes('oauth-protected-resource')(url)) {
			return Response.json({
				authorization_servers: ['https://silent.example.com'],
				resource: 'https://silent.example.com/mcp'
			})
		}
		return Response.json({
			authorization_endpoint: 'https://silent.example.com/oauth/authorize',
			client_id_metadata_document_supported: true,
			issuer: 'https://silent.example.com',
			response_types_supported: ['code'],
			token_endpoint: 'https://silent.example.com/oauth/token'
		})
	}
	if (String.includes('challenge.example.com')(url)) return new Response(undefined, {status: 404})
	if (String.includes('identity.example.com')(url)) {
		return Response.json({
			authorization_endpoint: 'https://identity.example.com/oauth/authorize',
			authorization_response_iss_parameter_supported: true,
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

// A test route answers a refusal with its message, as the page shows it.
function refused<E, R>(handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) {
	return Effect.catchIf(handler, Schema.is(AuthError), failure =>
		Effect.succeed(HttpServerResponse.text(failure.message, {status: 400}))
	)
}

function account(login?: string) {
	return pipe(
		Option.fromUndefinedOr(ACCOUNTS[login ?? '']),
		Effect.fromOption,
		Effect.mapError(() => AuthError.make({message: 'Sign in first'}))
	)
}

// Auth as the gateway sees it: an agent token for the gateway's MCP, or a browser session.
const layerAuth = Layer.succeedContext(
	Auth.makeContext(
		Auth.of({
			access: (headers, resource) => {
				const token = String.replace(/^Bearer /u, '')(headers['authorization'] ?? '')
				if (resource !== `${GATEWAY_URL}/mcp` || !String.startsWith('agent-')(token)) {
					return Effect.fail(AuthError.make({message: 'Sign in first'}))
				}
				return account(String.split(String.slice(6)(token), '-')[0])
			},
			user: headers => account(Cookies.parseHeader(headers['cookie'] ?? '')['session'])
		})
	)
)

const servers = Effect.fnUntraced(function* (home?: string) {
	const directory = home ?? (yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped())
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
	const grants = MutableList.make<{client: string; grant: string; refresh: string; resource: string}>()
	const registrations = MutableList.make<{redirect: string; url: string}>()
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
	// The providers' registration and token endpoints; each registration gets a new client id.
	const provider = HttpClient.make(request =>
		Effect.gen(function* () {
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
			if (request.body._tag !== 'Uint8Array') {
				return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
			}
			const text = new TextDecoder().decode(request.body.body)
			if (String.endsWith('/register')(request.url)) {
				MutableList.append(registrations, {
					redirect: (yield* Effect.orDie(
						Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({redirect_uris: Schema.Tuple([Schema.String])})))(
							text
						)
					)).redirect_uris[0],
					url: request.url
				})
				return HttpClientResponse.fromWeb(request, Response.json({client_id: `client-${registrations.length}`}))
			}
			if (String.endsWith('/token')(request.url)) {
				const form = new URLSearchParams(text)
				MutableList.append(grants, {
					client: form.get('client_id') ?? '',
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
	const web = yield* Effect.acquireRelease(
		Effect.sync(() =>
			HttpRouter.toWebHandler(
				pipe(
					Layer.mergeAll(
						HttpHandlers,
						layerMcp,
						// The servers page's RPCs.
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
										refused
									)
								),
								HttpRouter.add(
									'POST',
									'/servers/disconnect',
									pipe(
										Effect.gen(function* () {
											const input = yield* HttpServerRequest.schemaBodyJson(ServerParams)
											yield* (yield* Connections).disconnect(input.id, yield* CurrentUser)
											return HttpServerResponse.empty()
										}),
										refused
									)
								),
								HttpRouter.add(
									'POST',
									'/servers/hide',
									pipe(
										Effect.gen(function* () {
											const input = yield* HttpServerRequest.schemaBodyJson(ToolVisibility)
											yield* (yield* Connections).hide(input, yield* CurrentUser)
											return HttpServerResponse.empty()
										}),
										refused
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
										refused
									)
								),
								HttpRouter.add(
									'GET',
									'/servers',
									pipe(
										Effect.gen(function* () {
											return yield* HttpServerResponse.schemaJson(Schema.Array(ConnectionInfo))(
												yield* Effect.flatMap(
													Stream.runHead((yield* Connections).watch(yield* CurrentUser)),
													Effect.fromOption
												)
											)
										}),
										refused
									)
								)
							),
							Layer.provide(HttpAuth.layer)
						)
					),
					Layer.provideMerge(Gateway.layer),
					Layer.provideMerge(Connections.layer),
					Layer.provide(
						Layer.mergeAll(
							NodeCrypto.layer,
							NodeServices.layer,
							Layer.succeed(HttpClient.HttpClient, provider),
							Layer.succeed(FetchHttpClient.Fetch, fetchUpstream),
							ConfigProvider.layer(
								ConfigProvider.fromUnknown({GITHUB_ADMINS: '42', HOME: directory, NODE_ENV: 'production'})
							)
						)
					),
					Layer.provideMerge(layerAuth),
					Layer.provideMerge(Layer.succeed(Clock.Clock, clock))
				),
				{disableLogger: true}
			)
		),
		handler => Effect.promise(() => handler.dispose())
	)
	return {
		grants,
		pauseReject,
		ready,
		registrations,
		rejectAccess,
		rejectContinue,
		rejectReady,
		sessions,
		stall,
		stallReady,
		toolNames,
		upstreamRequests,
		web
	}
})

type Web = Effect.Success<ReturnType<typeof servers>>['web']

function send(web: Web, path: string, init?: RequestInit) {
	return Effect.promise(() => web.handler(new Request(new URL(path, GATEWAY_URL), init)))
}

function cookie(response: Response) {
	return pipe(
		response.headers.getSetCookie(),
		Array.map(value => Array.headNonEmpty(String.split(value, ';'))),
		Array.join('; ')
	)
}

// A JSON body, posted by the signed-in session in `session`.
const post = Effect.fnUntraced(function* (web: Web, path: string, session: string, body: unknown) {
	return yield* send(web, path, {
		body: yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(body),
		headers: {'content-type': 'application/json', cookie: session},
		method: 'POST'
	})
})

const addMcp = Effect.fnUntraced(function* (web: Web, url: string) {
	const response = yield* post(web, '/servers', SESSION, {url})
	assert.strictEqual(response.status, 200)
	return yield* Schema.decodeEffect(Schema.fromJsonString(ConnectionInfo))(yield* Effect.promise(() => response.text()))
})

// A provider sign-in through the servers page: the connect redirect, then the provider's answer at the callback.
const connect = Effect.fnUntraced(function* (web: Web, id: string, answer: Record<string, string>) {
	const start = yield* send(web, `/oauth/connect?id=${id}`, {headers: {cookie: SESSION}})
	return yield* send(
		web,
		`/oauth/callback/${id}?${new URLSearchParams({...answer, state: new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? ''})}`,
		{headers: {cookie: `${SESSION}; ${cookie(start)}`}}
	)
})

const listServers = Effect.fnUntraced(function* (web: Web) {
	const response = yield* send(web, '/servers', {headers: {cookie: SESSION}})
	return yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Array(ConnectionInfo)))(
		yield* Effect.promise(() => response.text())
	)
})

// An MCP client's initialize, then the tool call with the session it got.
const callTool = Effect.fnUntraced(function* (web: Web, token: string, name: string, input: Record<string, unknown>) {
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

const modern = Effect.fnUntraced(function* (
	web: Web,
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
		'discovers challenge-only metadata and authorizes with a client metadata document only when the answer names its issuer',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			const added = yield* addMcp(gateway.web, 'https://challenge.example.com/mcp')
			assert.strictEqual(added.status, 'Not connected')
			const answerWith = Effect.fnUntraced(function* (search: Record<string, string>) {
				const start = yield* send(gateway.web, `/oauth/connect?id=${added.id}`, {headers: {cookie: SESSION}})
				const target = new URL(start.headers.get('location') ?? '')
				assert.strictEqual(target.searchParams.get('client_id'), `${GATEWAY_URL}/oauth/client.json`)
				assert.strictEqual(target.searchParams.get('scope'), 'items:read')
				return yield* send(
					gateway.web,
					`/oauth/callback?${new URLSearchParams({code: 'approved', ...search, state: target.searchParams.get('state') ?? ''})}`,
					{headers: {cookie: `${SESSION}; ${cookie(start)}`}}
				)
			})
			// RFC 9700 §4.4.2: without `iss`, an answer to the shared callback could come from any provider.
			assert.strictEqual((yield* answerWith({})).headers.get('location'), '/')
			assert.strictEqual(gateway.grants.length, 0)
			assert.strictEqual((yield* answerWith({iss: 'https://identity.example.com'})).headers.get('location'), '/')
			assert.strictEqual(gateway.grants.length, 1)
			assert.strictEqual(
				(yield* post(gateway.web, '/servers', SESSION, {url: 'https://silent.example.com/mcp'})).status,
				400
			)
		})
	)
	test.effect(
		'encodes unsafe tool names and keeps vanished and removed tools out of lists and calls',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			const added = yield* addMcp(gateway.web, 'https://public.example.com/mcp')
			yield* Ref.set(gateway.toolNames, ['search.docs', 'search_docs', 'search__encoded_literal'])
			// The server's tools an agent lists right now.
			const listed = Effect.fnUntraced(function* () {
				const response = yield* modern(gateway.web, TOKEN, 'tools/list')
				return Array.filter(
					Array.map(
						(yield* Schema.decodeEffect(
							Schema.fromJsonString(Schema.Struct({result: Schema.Struct({tools: Schema.Array(McpSchema.Tool)})}))
						)(yield* Effect.promise(() => response.text()))).result.tools,
						tool => tool.name
					),
					String.startsWith(`${added.id}__`)
				)
			})
			const remote = yield* listed()
			assert.strictEqual(remote.length, 3)
			assert.strictEqual(Array.dedupe(remote).length, 3)
			for (const name of remote) assert.match(name, /^[a-zA-Z0-9_-]{1,64}$/u)
			const encoded = yield* Effect.fromOption(
				Array.findFirst(remote, String.startsWith(`${added.id}__search_docs__encoded_`))
			)
			yield* modern(gateway.web, TOKEN, 'tools/call', {arguments: {query: 'dotted'}, name: encoded})
			assert.isTrue(
				Array.some(MutableList.toArray(gateway.upstreamRequests), request =>
					Schema.is(
						Schema.Struct({
							method: Schema.Literal('tools/call'),
							params: Schema.Struct({name: Schema.Literal('search.docs')})
						})
					)(request.body)
				)
			)
			yield* Ref.set(gateway.toolNames, ['search_docs'])
			yield* modern(gateway.web, TOKEN, 'tools/list')
			assert.deepStrictEqual(yield* listed(), [`${added.id}__search_docs`])
			const vanished = yield* modern(gateway.web, TOKEN, 'tools/call', {arguments: {query: 'gone'}, name: encoded})
			assert.isTrue(String.includes('error')(yield* Effect.promise(() => vanished.text())))
			yield* post(gateway.web, '/servers/remove', SESSION, {id: added.id})
			yield* modern(gateway.web, TOKEN, 'tools/list')
			assert.deepStrictEqual(yield* listed(), [])
		})
	)
	test.effect(
		'keeps the tools an admin unchecks out of agents’ lists and calls',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* Ref.set(gateway.toolNames, ['search', 'delete'])
			const added = yield* addMcp(gateway.web, 'https://public.example.com/mcp')
			assert.deepStrictEqual(added.tools, ['search', 'delete'])
			// Each toggle changes only its own tool, so a quick second one keeps the first.
			yield* Effect.forEach(
				[
					{hidden: true, tool: 'delete'},
					{hidden: true, tool: 'search'},
					{hidden: false, tool: 'search'}
				],
				change =>
					Effect.map(post(gateway.web, '/servers/hide', SESSION, {...change, id: added.id}), response =>
						assert.strictEqual(response.status, 204)
					),
				{concurrency: 1, discard: true}
			)
			const listed = yield* modern(gateway.web, TOKEN, 'tools/list')
			const names = yield* Effect.promise(() => listed.text())
			assert.isTrue(String.includes(`${added.id}__search`)(names))
			assert.isFalse(String.includes(`${added.id}__delete`)(names))
			const called = yield* modern(gateway.web, TOKEN, 'tools/call', {
				arguments: {query: 'hidden'},
				name: `${added.id}__delete`
			})
			assert.isTrue(String.includes('error')(yield* Effect.promise(() => called.text())))
			assert.isFalse(
				Array.some(MutableList.toArray(gateway.upstreamRequests), request =>
					Schema.is(
						Schema.Struct({
							method: Schema.Literal('tools/call'),
							params: Schema.Struct({name: Schema.Literal('delete')})
						})
					)(request.body)
				)
			)
			// An agent reads only how many tools it can call.
			const connections = yield* callTool(gateway.web, TOKEN, 'list_mcp_connections', {})
			assert.deepStrictEqual(
				(yield* Schema.decodeEffect(
					Schema.fromJsonString(
						Schema.Struct({
							result: Schema.Struct({
								structuredContent: Schema.Struct({
									servers: Schema.Array(Schema.Struct({id: Schema.String, tools: Schema.Int}))
								})
							})
						})
					)
				)(yield* Effect.promise(() => connections.text()))).result.structuredContent.servers,
				[{id: added.id, tools: 1}]
			)
		})
	)
	test.effect(
		'never retries an old URL with a removed and replaced connection’s credentials',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* addMcp(gateway.web, PROVIDERS.mobbin.url)
			const approve = connect(gateway.web, 'mobbin', {code: 'approved', iss: PROVIDERS.mobbin.issuer})
			yield* approve
			yield* modern(gateway.web, TOKEN, 'tools/list')
			yield* Ref.set(gateway.rejectAccess, 'Bearer upstream-authorization_code-1')
			yield* Ref.set(gateway.pauseReject, true)
			const pending = yield* Effect.forkScoped(
				modern(gateway.web, TOKEN, 'tools/call', {arguments: {query: 'racing'}, name: 'mobbin__search'})
			)
			yield* Queue.take(gateway.rejectReady)
			yield* post(gateway.web, '/servers/remove', SESSION, {id: 'mobbin'})
			assert.strictEqual((yield* addMcp(gateway.web, 'https://app.mobbin.net/mcp')).id, 'mobbin')
			yield* approve
			yield* Queue.offer(gateway.rejectContinue, true)
			const response = yield* Fiber.join(pending)
			assert.isTrue(String.includes('isError')(yield* Effect.promise(() => response.text())))
			assert.isFalse(
				Array.some(
					MutableList.toArray(gateway.upstreamRequests),
					request =>
						request.url === PROVIDERS.mobbin.url && request.authorization === 'Bearer upstream-authorization_code-2'
				)
			)
			assert.strictEqual(gateway.grants.length, 2)
		})
	)
	test.effect(
		'adds arbitrary MCP URLs without a catalog and isolates removed and re-added servers',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			assert.deepStrictEqual(yield* listServers(gateway.web), [])
			const publicServer = yield* addMcp(gateway.web, 'https://public.example.com/mcp')
			assert.strictEqual(publicServer.status, 'Connected')
			assert.deepStrictEqual(publicServer.tools, ['search'])
			assert.strictEqual(MutableHashMap.size(gateway.sessions), 0)
			const external = yield* addMcp(gateway.web, 'https://mcp.example.com/mcp')
			const collision = yield* addMcp(gateway.web, 'https://mcp.example.net/mcp')
			assert.strictEqual(external.id, 'example')
			assert.match(collision.id, /^example_[a-z0-9_-]{6}$/u)
			assert.strictEqual(external.status, 'Not connected')
			const before = yield* modern(gateway.web, TOKEN, 'tools/list')
			const beforeText = yield* Effect.promise(() => before.text())
			assert.isTrue(String.includes(`${publicServer.id}__search`)(beforeText))
			assert.isFalse(String.includes('example__search')(beforeText))
			assert.strictEqual((yield* post(gateway.web, '/servers/remove', SESSION, {id: publicServer.id})).status, 204)
			assert.strictEqual((yield* addMcp(gateway.web, publicServer.url)).id, publicServer.id)
			const previousRequests = MutableList.toArray(gateway.upstreamRequests)
			const stale = yield* modern(gateway.web, TOKEN, 'tools/call', {
				arguments: {query: 'stale definition'},
				name: `${publicServer.id}__search`
			})
			assert.isTrue(String.includes('error')(yield* Effect.promise(() => stale.text())))
			assert.deepStrictEqual(MutableList.toArray(gateway.upstreamRequests), previousRequests)
			yield* modern(gateway.web, TOKEN, 'tools/list')
			const called = yield* modern(gateway.web, TOKEN, 'tools/call', {
				arguments: {query: 'new definition'},
				name: `${publicServer.id}__search`
			})
			assert.isTrue(String.includes('new definition')(yield* Effect.promise(() => called.text())))
			assert.strictEqual((yield* post(gateway.web, '/servers', SESSION, {url: publicServer.url})).status, 400)
			// Only an admin adds servers, and the gateway is never one of them.
			assert.deepStrictEqual(
				[
					(yield* post(gateway.web, '/servers', 'session=stranger', {url: 'https://another.example.com/mcp'})).status,
					(yield* post(gateway.web, '/servers', SESSION, {url: `${GATEWAY_URL}/mcp`})).status
				],
				[400, 400]
			)
			const snapshot = yield* send(gateway.web, '/servers', {headers: {cookie: SESSION}})
			const snapshotText = yield* Effect.promise(() => snapshot.text())
			assert.isFalse(String.includes('access_token')(snapshotText))
			assert.isFalse(String.includes('refresh_token')(snapshotText))
			assert.strictEqual(MutableHashMap.size(gateway.sessions), 0)
		})
	)
	test.effect(
		'shares provider authorization across harnesses and restarts while bridging stateless calls to legacy sessions',
		Effect.fnUntraced(function* () {
			const home = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			yield* Effect.scoped(
				Effect.gen(function* () {
					const gateway = yield* servers(home)
					assert.strictEqual((yield* modern(gateway.web, '', 'tools/list')).status, 401)
					assert.strictEqual(gateway.upstreamRequests.length, 0)
					yield* addMcp(gateway.web, PROVIDERS.mobbin.url)
					yield* addMcp(gateway.web, 'https://public.example.com/mcp')
					const start = yield* send(gateway.web, '/oauth/connect?id=mobbin', {headers: {cookie: SESSION}})
					const target = new URL(start.headers.get('location') ?? '')
					assert.strictEqual(target.searchParams.get('code_challenge_method'), 'S256')
					assert.strictEqual(target.searchParams.get('resource'), PROVIDERS.mobbin.url)
					// A registered client answers at its own server's callback, so another provider's answer cannot land there.
					assert.strictEqual(target.searchParams.get('redirect_uri'), `${GATEWAY_URL}/oauth/callback/mobbin`)
					const callback = `/oauth/callback/mobbin?${new URLSearchParams({code: 'provider-code', iss: PROVIDERS.mobbin.issuer, state: target.searchParams.get('state') ?? ''})}`
					assert.strictEqual(
						(yield* send(gateway.web, callback, {headers: {cookie: SESSION}})).headers.get('location'),
						'/'
					)
					assert.strictEqual(gateway.grants.length, 0)
					assert.strictEqual(
						(yield* send(gateway.web, callback, {headers: {cookie: `${SESSION}; ${cookie(start)}`}})).status,
						302
					)
					assert.strictEqual(
						(yield* send(gateway.web, callback, {headers: {cookie: `${SESSION}; ${cookie(start)}`}})).status,
						302
					)
					assert.strictEqual(gateway.grants.length, 1)
					const listed = yield* modern(gateway.web, TOKEN, 'tools/list')
					assert.strictEqual(listed.status, 200)
					const tools = (yield* Schema.decodeEffect(
						Schema.fromJsonString(Schema.Struct({result: Schema.Struct({tools: Schema.Array(McpSchema.Tool)})}))
					)(yield* Effect.promise(() => listed.text()))).result.tools
					assert.isTrue(
						Array.some(tools, tool => tool.name === 'mobbin__search' && tool.annotations?.readOnlyHint === true)
					)
					assert.isTrue(Array.some(tools, tool => tool.name === 'public__search'))
					const result = yield* modern(gateway.web, TOKEN, 'tools/call', {
						arguments: {query: 'onboarding'},
						name: 'mobbin__search'
					})
					const text = yield* Effect.promise(() => result.text())
					assert.isTrue(String.includes('aGVsbG8=')(text))
					assert.isTrue(String.includes('onboarding')(text))
					assert.isFalse(String.includes('upstream-')(text))
					assert.isFalse(String.includes('refresh-')(text))
					assert.strictEqual((yield* callTool(gateway.web, TOKEN, 'mobbin__search', {query: 'claude'})).status, 200)
					assert.strictEqual(MutableHashMap.size(gateway.sessions), 0)
					assert.deepStrictEqual(MutableList.toArray(gateway.grants), [
						{client: 'client-2', grant: 'authorization_code', refresh: '', resource: PROVIDERS.mobbin.url}
					])
				})
			)
			const gateway = yield* servers(home)
			// Another harness of the same account, signed in on another machine.
			const second = `${TOKEN}-laptop`
			yield* modern(gateway.web, second, 'tools/list')
			assert.strictEqual(gateway.grants.length, 0)
			assert.strictEqual(
				(yield* modern(gateway.web, TOKEN, 'tools/call', {
					arguments: {query: 'original machine'},
					name: 'mobbin__search'
				})).status,
				200
			)
			yield* TestClock.adjust('40 seconds')
			const toolError = yield* modern(gateway.web, second, 'tools/call', {
				arguments: {query: 'fail'},
				name: 'mobbin__search'
			})
			assert.isTrue(
				(yield* Schema.decodeEffect(
					Schema.fromJsonString(Schema.Struct({result: Schema.Struct({isError: Schema.Boolean})}))
				)(yield* Effect.promise(() => toolError.text()))).result.isError
			)
			assert.deepStrictEqual(MutableList.toArray(gateway.grants), [
				{
					client: 'client-2',
					grant: 'refresh_token',
					refresh: 'refresh-authorization_code-1',
					resource: PROVIDERS.mobbin.url
				}
			])
			yield* Ref.set(gateway.rejectAccess, 'Bearer upstream-refresh_token-1')
			yield* Effect.all([modern(gateway.web, TOKEN, 'tools/list'), modern(gateway.web, second, 'tools/list')], {
				concurrency: 'unbounded'
			})
			assert.deepStrictEqual(
				Array.map(MutableList.toArray(gateway.grants), grant => grant.refresh),
				['refresh-authorization_code-1', 'refresh-refresh_token-1']
			)
			yield* Ref.set(gateway.stall, true)
			const slowList = yield* Effect.forkScoped(modern(gateway.web, second, 'tools/list'))
			yield* Queue.take(gateway.stallReady)
			yield* TestClock.adjust('2 seconds')
			const partial = yield* Fiber.join(slowList)
			const partialText = yield* Effect.promise(() => partial.text())
			assert.isTrue(String.includes('list_mcp_connections')(partialText))
			assert.isTrue(String.includes('public__search')(partialText))
			assert.strictEqual((yield* modern(gateway.web, TOKEN, 'tools/list')).status, 200)
			assert.strictEqual((yield* post(gateway.web, '/servers/disconnect', SESSION, {id: 'mobbin'})).status, 204)
			const disconnected = yield* modern(gateway.web, TOKEN, 'tools/call', {
				arguments: {query: 'blocked'},
				name: 'mobbin__search'
			})
			yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Struct({error: Schema.Struct({code: Schema.Int})})))(
				yield* Effect.promise(() => disconnected.text())
			)
			const listed = yield* modern(gateway.web, second, 'tools/list')
			assert.isFalse(String.includes('mobbin__search')(yield* Effect.promise(() => listed.text())))
			yield* Ref.set(gateway.stall, false)
			yield* TestClock.adjust('21 seconds')
			assert.strictEqual(MutableHashMap.size(gateway.sessions), 0)
		})
	)
	test.effect(
		'connects a Deslop MCP like any provider, with Auth as its authorization server',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			const added = yield* addMcp(gateway.web, 'https://stash.mp281x.xyz/mcp')
			assert.strictEqual(added.status, 'Not connected')
			const start = yield* send(gateway.web, `/oauth/connect?id=${added.id}`, {headers: {cookie: SESSION}})
			const target = new URL(start.headers.get('location') ?? '')
			assert.deepStrictEqual(
				[
					`${target.origin}${target.pathname}`,
					target.searchParams.get('redirect_uri'),
					target.searchParams.get('resource'),
					target.searchParams.get('scope')
				],
				[
					`${AUTH_URL}/api/auth/oauth2/authorize`,
					`${GATEWAY_URL}/oauth/callback/${added.id}`,
					'https://stash.mp281x.xyz/mcp',
					'deslop'
				]
			)
			// Discovery registers once to check the provider, and each connection registers anew.
			assert.deepStrictEqual(
				Array.map(
					MutableList.toArray(gateway.registrations),
					registration => `${registration.url} ${registration.redirect}`
				),
				Array.replicate(`${AUTH_URL}/api/auth/oauth2/register ${GATEWAY_URL}/oauth/callback/${added.id}`, 2)
			)
			assert.strictEqual(
				(yield* send(
					gateway.web,
					`/oauth/callback/${added.id}?${new URLSearchParams({code: 'approved', iss: `${AUTH_URL}/api/auth`, state: target.searchParams.get('state') ?? ''})}`,
					{headers: {cookie: `${SESSION}; ${cookie(start)}`}}
				)).headers.get('location'),
				'/'
			)
			assert.deepStrictEqual(MutableList.toArray(gateway.grants), [
				{client: 'client-2', grant: 'authorization_code', refresh: '', resource: 'https://stash.mp281x.xyz/mcp'}
			])
			assert.isTrue(
				String.includes(`${added.id}__search`)(
					yield* Effect.flatMap(modern(gateway.web, TOKEN, 'tools/list'), response =>
						Effect.promise(() => response.text())
					)
				)
			)
			assert.isTrue(
				Array.some(
					MutableList.toArray(gateway.upstreamRequests),
					upstream =>
						upstream.url === 'https://stash.mp281x.xyz/mcp' &&
						upstream.authorization === 'Bearer upstream-authorization_code-1'
				)
			)
		})
	)
	test.effect(
		'keeps a working connection and its client when a reconnect is abandoned',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* addMcp(gateway.web, PROVIDERS.mobbin.url)
			yield* connect(gateway.web, 'mobbin', {code: 'approved', iss: PROVIDERS.mobbin.issuer})
			yield* modern(gateway.web, TOKEN, 'tools/list')
			// The reconnect registers a client of its own, then never comes back.
			yield* send(gateway.web, '/oauth/connect?id=mobbin', {headers: {cookie: SESSION}})
			assert.strictEqual(gateway.registrations.length, 3)
			yield* TestClock.adjust('40 seconds')
			const called = yield* modern(gateway.web, TOKEN, 'tools/call', {
				arguments: {query: 'still connected'},
				name: 'mobbin__search'
			})
			assert.isTrue(String.includes('still connected')(yield* Effect.promise(() => called.text())))
			assert.deepStrictEqual(
				Array.map(MutableList.toArray(gateway.grants), grant => `${grant.grant}:${grant.client}`),
				['authorization_code:client-2', 'refresh_token:client-2']
			)
		})
	)
	test.effect(
		'moves the previous release’s servers out of Auth, without its delegated Deslop ones',
		Effect.fnUntraced(function* () {
			const fs = yield* FileSystem.FileSystem
			const home = yield* fs.makeTempDirectoryScoped()
			const previous = `${home}/.deslop/auth/mcp/servers`
			const row = {generation: 'previous', hidden: [], link: {_tag: 'Connected'}, name: 'Example', tools: ['search']}
			yield* fs.makeDirectory(`${home}/.deslop/auth/mcp`, {recursive: true})
			yield* fs.writeFileString(
				previous,
				yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
					mobbin: {
						...row,
						id: 'mobbin',
						link: {
							_tag: 'Authorized',
							expiresAt: 0,
							token: {access_token: 'saved-access', refresh_token: 'saved-refresh', token_type: 'Bearer'}
						},
						mode: 'oauth',
						oauth: {
							client: {_tag: 'Registered', clientId: 'auth-client'},
							metadata: {
								authorization_endpoint: `${PROVIDERS.mobbin.issuer}/oauth/authorize`,
								issuer: PROVIDERS.mobbin.issuer,
								token_endpoint: `${PROVIDERS.mobbin.issuer}/oauth/token`
							},
							scope: ''
						},
						url: PROVIDERS.mobbin.url
					},
					public: {...row, id: 'public', mode: 'public', url: 'https://public.example.com/mcp'},
					stash: {...row, id: 'stash', mode: 'deslop', url: 'https://stash.mp281x.xyz/mcp'}
				})
			)
			const gateway = yield* servers(home)
			assert.deepStrictEqual(
				Array.map(yield* listServers(gateway.web), server => `${server.id}:${server.status}`),
				['mobbin:Connected', 'public:Connected']
			)
			assert.isFalse(yield* fs.exists(previous))
			const kept = yield* fs.readFileString(`${home}/.deslop/gateway/servers`)
			assert.isFalse(String.includes('deslop')(kept))
			assert.isTrue(String.includes('saved-refresh')(kept))
			// The moved tokens refresh with the client Auth registered for them.
			yield* modern(gateway.web, TOKEN, 'tools/list')
			assert.deepStrictEqual(MutableList.toArray(gateway.grants), [
				{client: 'auth-client', grant: 'refresh_token', refresh: 'saved-refresh', resource: PROVIDERS.mobbin.url}
			])
		})
	)
	test.effect(
		'does not retain the previous account’s refresh token when a new authorization omits one',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* addMcp(gateway.web, PROVIDERS.mobbin.url)
			for (const code of ['provider-code', 'no-refresh']) {
				assert.strictEqual((yield* connect(gateway.web, 'mobbin', {code, iss: PROVIDERS.mobbin.issuer})).status, 302)
			}
			yield* modern(gateway.web, TOKEN, 'tools/list')
			const shortLived = yield* modern(gateway.web, TOKEN, 'tools/call', {
				arguments: {query: 'still valid'},
				name: 'mobbin__search'
			})
			assert.isTrue(String.includes('still valid')(yield* Effect.promise(() => shortLived.text())))
			const requestsBeforeExpiry = MutableList.toArray(gateway.upstreamRequests)
			const updates = yield* pipe(
				send(gateway.web, '/server-events', {headers: {cookie: SESSION}}),
				Effect.flatMap(response => Effect.promise(() => response.text())),
				Effect.forkScoped
			)
			yield* Queue.take(gateway.ready)
			// The list is read again each minute, so the token's end at 30 seconds shows by the next read.
			yield* TestClock.adjust('61 seconds')
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
			yield* modern(gateway.web, TOKEN, 'tools/list')
			assert.deepStrictEqual(
				Array.map(MutableList.toArray(gateway.grants), grant => grant.grant),
				['authorization_code', 'authorization_code']
			)
			assert.deepStrictEqual(MutableList.toArray(gateway.upstreamRequests), requestsBeforeExpiry)
		})
	)
	test.effect(
		'rejects provider callbacks from another issuer and non-admin connection management',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* addMcp(gateway.web, PROVIDERS.mobbin.url)
			assert.strictEqual(
				(yield* send(gateway.web, '/oauth/connect?id=mobbin', {headers: {cookie: 'session=stranger'}})).headers.get(
					'location'
				),
				'/'
			)
			// A signed-out browser signs in first, then returns to the connection.
			assert.match(
				(yield* send(gateway.web, '/oauth/connect?id=mobbin')).headers.get('location') ?? '',
				/^\/auth\/sign-in\?next=/u
			)
			// A registered client's answer at the shared callback is another provider's, even when it names this issuer.
			const shared = yield* send(gateway.web, '/oauth/connect?id=mobbin', {headers: {cookie: SESSION}})
			const misrouted = new URLSearchParams({
				code: 'attacker-code',
				iss: PROVIDERS.mobbin.issuer,
				state: new URL(shared.headers.get('location') ?? '').searchParams.get('state') ?? ''
			})
			yield* send(gateway.web, `/oauth/callback?${misrouted}`, {headers: {cookie: `${SESSION}; ${cookie(shared)}`}})
			assert.strictEqual(gateway.grants.length, 0)
			const start = yield* send(gateway.web, '/oauth/connect?id=mobbin', {headers: {cookie: SESSION}})
			const params = new URLSearchParams({
				code: 'attacker-code',
				iss: 'https://evil.test',
				state: new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? ''
			})
			assert.strictEqual(
				(yield* send(gateway.web, `/oauth/callback/mobbin?${params}`, {
					headers: {cookie: `${SESSION}; ${cookie(start)}`}
				})).status,
				302
			)
			assert.strictEqual(gateway.grants.length, 0)
			// The servers page names why the connection failed.
			assert.deepStrictEqual(
				Array.map(yield* listServers(gateway.web), server => server.error),
				['The answer came from another authorization server']
			)
			params.set('iss', PROVIDERS.mobbin.issuer)
			assert.strictEqual(
				(yield* send(gateway.web, `/oauth/callback/mobbin?${params}`, {
					headers: {cookie: `${SESSION}; ${cookie(start)}`}
				})).status,
				302
			)
			assert.strictEqual(gateway.grants.length, 0)
			// A provider cannot redirect metadata discovery to a different issuer.
			assert.strictEqual((yield* post(gateway.web, '/servers', SESSION, {url: PROVIDERS.dual.url})).status, 400)
			// Only an admin manages the servers everyone shares.
			assert.strictEqual(
				(yield* post(gateway.web, '/servers/disconnect', 'session=stranger', {id: 'mobbin'})).status,
				400
			)
		})
	)
})
