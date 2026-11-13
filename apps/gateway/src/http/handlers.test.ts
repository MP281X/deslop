import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	Clock,
	ConfigProvider,
	Context,
	Deferred,
	Duration,
	Effect,
	FileSystem,
	Fiber,
	Layer,
	MutableHashMap,
	MutableList,
	Option,
	Order,
	Queue,
	Redacted,
	Ref,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
import {McpSchema, McpServer} from 'effect/ai'
import {Cookies, FetchHttpClient, HttpClient, HttpClientResponse, HttpRouter} from 'effect/http'
import {RpcTest} from 'effect/rpc'
import {SqlClient} from 'effect/sql'
import {TestClock} from 'effect/testing'

import {Auth} from '@deslop/runtime/server/auth'
import {layerDataStore} from '@deslop/runtime/server/store'
import {AUTH_URL, AuthError} from '@deslop/runtime/shared/auth'
import type {User} from '@deslop/runtime/shared/auth'

import {AiHttpHandlers, HttpHandlers} from '#http/handlers.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import type {AiProvider, AiUsageReport} from '#services/ai-proxy/schema.ts'
import {AiProxy} from '#services/ai-proxy/service.ts'
import {mcpClient} from '#services/connections/lib/utils.ts'
import {ConnectionItem} from '#services/connections/schema.ts'
import type {McpUsageReport} from '#services/connections/schema.ts'
import {Connections} from '#services/connections/service.ts'
import {Gateway} from '#services/gateway/service.ts'
import type {UsageRange} from '#services/usage/schema.ts'
import {GatewayMcp} from '#tools/handlers.ts'

const GATEWAY_URL = 'https://gateway.mp281x.xyz'
const ACCOUNTS: Record<string, User> = {
	dev: {id: 'github:0', name: 'dev'},
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
const SESSION = 'session=octocat'
const TOKEN = 'agent.octocat.signature'

function discoveryResponse(url: string, challengeMethods?: string[]) {
	if (url === 'https://challenge.example.com/resource-info') {
		return Response.json({
			authorization_servers: ['https://identity.example.com'],
			resource: 'https://challenge.example.com/mcp'
		})
	}
	if (!String.includes('/.well-known/')(url)) return undefined
	if (String.endsWith('.mp281x.xyz')(new URL(url).hostname) && String.includes('oauth-protected-resource')(url)) {
		return Response.json({
			authorization_servers: [`${AUTH_URL}/api/auth`],
			resource: `${new URL(url).origin}/mcp`,
			scopes_supported: ['deslop']
		})
	}
	if (url === 'https://mimic.example.com/.well-known/oauth-protected-resource/mcp') {
		return Response.json({authorization_servers: [`${AUTH_URL}/api/auth`], resource: 'https://mimic.example.com/mcp'})
	}
	if (url === `${AUTH_URL}/.well-known/oauth-authorization-server/api/auth`) {
		return Response.json({
			authorization_endpoint: `${AUTH_URL}/api/auth/oauth2/authorize`,
			authorization_response_iss_parameter_supported: true,
			code_challenge_methods_supported: challengeMethods,
			issuer: `${AUTH_URL}/api/auth`,
			registration_endpoint: `${AUTH_URL}/api/auth/oauth2/register`,
			response_types_supported: ['code'],
			token_endpoint: `${AUTH_URL}/api/auth/oauth2/token`
		})
	}
	if (String.startsWith(AUTH_URL)(url)) return new Response(undefined, {status: 404})
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
			code_challenge_methods_supported: challengeMethods,
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
			code_challenge_methods_supported: challengeMethods,
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
		authorization_endpoint: `${PROVIDERS.mobbin.issuer}/oauth/authorize?tenant=required`,
		authorization_response_iss_parameter_supported: true,
		code_challenge_methods_supported: challengeMethods,
		issuer: PROVIDERS.mobbin.issuer,
		registration_endpoint: `${PROVIDERS.mobbin.issuer}/oauth/clients/register`,
		response_types_supported: ['code'],
		token_endpoint: `${PROVIDERS.mobbin.issuer}/oauth/token`
	})
}

function makeUpstreamResponse(url: string) {
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

function upstreamHttpResponse(request: Request, challengeMethods?: string[]) {
	const metadata = discoveryResponse(request.url, challengeMethods)
	if (metadata !== undefined) return metadata
	if (request.method === 'GET') return new Response(undefined, {status: 405})
	if (request.url === 'https://challenge.example.com/mcp') return makeUpstreamResponse(request.url)
	return undefined
}

function account(login?: string) {
	return pipe(
		Option.fromUndefinedOr(ACCOUNTS[login ?? '']),
		Effect.fromOption,
		Effect.mapError(() => AuthError.make({message: 'Sign in first'}))
	)
}

// The provider's token endpoint: it refuses renewals while told to, and the `no-refresh` code issues a token it cannot renew.
function tokenAnswer(form: URLSearchParams, refuseRefresh: boolean, grants: number) {
	if (form.get('grant_type') === 'refresh_token' && refuseRefresh) {
		return Response.json({error: 'invalid_grant'}, {status: 400})
	}
	if (form.get('code') === 'no-refresh') {
		return Response.json({access_token: 'another-account', expires_in: 30, token_type: 'Bearer'})
	}
	return Response.json({
		access_token: `upstream-${form.get('grant_type') ?? ''}-${grants}`,
		expires_in: 60,
		refresh_token: `refresh-${form.get('grant_type') ?? ''}-${grants}`,
		token_type: 'Bearer'
	})
}

function layerAuth(verified: Ref.Ref<number>) {
	return Layer.succeedContext(
		Auth.makeContext(
			Auth.of({
				token: headers => Effect.succeed(String.replace(/^Bearer /u, '')(headers['authorization'] ?? 'browser-access')),
				user: headers => {
					const token = String.replace(/^Bearer /u, '')(headers['authorization'] ?? '')
					if (!String.startsWith('agent.')(token)) {
						return account(Cookies.parseHeader(headers['cookie'] ?? '')['session'])
					}
					return Effect.andThen(
						Ref.update(verified, count => count + 1),
						account(String.split(token, '.')[1])
					)
				}
			})
		)
	)
}

const servers = Effect.fnUntraced(function* (home?: string, origin: string = GATEWAY_URL, local: boolean = false) {
	const directory = home ?? (yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped())
	const clock = yield* Clock.Clock
	const scope = yield* Effect.scope
	const memoMap = yield* Layer.makeMemoMap
	const verified = yield* Ref.make(0)
	const rejectAccess = yield* Ref.make('never')
	const refuseRefresh = yield* Ref.make(false)
	const pauseReject = yield* Ref.make(false)
	const rejectReady = yield* Queue.make<true>()
	const rejectContinue = yield* Queue.make<true>()
	const toolNames = yield* Ref.make(['search'])
	const discoveryDelay = yield* Ref.make(0)
	const providerName = yield* Ref.make('legacy-provider')
	const challengeMethods = yield* Ref.make(Option.some(['S256']))
	const metadataUnavailable = yield* Ref.make(false)
	const stall = yield* Ref.make(false)
	const stallReady = yield* Queue.make<true>()
	const upstreamTools = yield* Queue.unbounded<void>()
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
	const listedTools = Effect.fnUntraced(function* (id?: number | string) {
		yield* Effect.sleep(`${yield* Ref.get(discoveryDelay)} millis`)
		yield* Queue.offer(upstreamTools, undefined)
		return Response.json({
			id,
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
	})
	function fetchUpstream(input: RequestInfo | URL, init?: RequestInit) {
		const request = new Request(input, init)
		// oxlint-disable-next-line no-restricted-properties -- The MCP SDK's FetchLike contract requires a Promise<Response>.
		return Effect.runPromise(
			Effect.gen(function* () {
				if (yield* Ref.get(metadataUnavailable)) {
					return new Response(undefined, {status: 503})
				}
				const metadata = upstreamHttpResponse(request, Option.getOrUndefined(yield* Ref.get(challengeMethods)))
				if (metadata !== undefined) return metadata
				if (request.method === 'DELETE') {
					MutableHashMap.remove(sessions, request.headers.get('mcp-session-id') ?? '')
					return new Response(undefined, {status: 204})
				}
				const message = yield* Schema.decodeEffect(
					Schema.fromJsonString(
						Schema.Struct({
							id: Schema.optionalKey(Schema.Union([Schema.Finite, Schema.String])),
							method: Schema.String,
							params: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown))
						})
					)
				)(yield* Effect.promise(() => request.text()))
				const authorization = request.headers.get('authorization') ?? ''
				MutableList.append(upstreamRequests, {authorization, body: message, method: message.method, url: request.url})
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
								serverInfo: {
									icons: [{src: 'https://example.com/icon.png', theme: 'dark'}, {src: 'javascript:alert(1)'}],
									name: yield* Ref.get(providerName),
									version: '1'
								}
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
				if (message.method === 'tools/list') return yield* listedTools(message.id)
				return Response.json({
					id: message.id,
					jsonrpc: '2.0',
					result: {
						content: [
							{text: 'search result', type: 'text'},
							{data: 'aGVsbG8=', mimeType: 'image/png', type: 'image'}
						],
						isError: Schema.is(Schema.Struct({query: Schema.Literal('fail')}))(message.params?.['arguments']),
						structuredContent: {query: message.params?.['arguments']}
					}
				})
			}),
			{signal: request.signal}
		)
	}
	const provider = HttpClient.make(request =>
		Effect.gen(function* () {
			if (new URL(request.url).origin === 'https://api.anthropic.com') {
				return HttpClientResponse.fromWeb(
					request,
					Response.json({usage: {cost: 0.123, input_tokens: 10, output_tokens: 5}})
				)
			}
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
				return HttpClientResponse.fromWeb(request, tokenAnswer(form, yield* Ref.get(refuseRefresh), grants.length))
			}
			return HttpClientResponse.fromWeb(request, new Response(undefined, {status: 404}))
		})
	)
	// The app's data store in the home's directory, so a second set of servers on the same home is a restart.
	const store = layerDataStore(directory)
	const database = yield* Layer.buildWithMemoMap(store, memoMap, scope)
	const platform = Layer.mergeAll(
		NodeCrypto.layer,
		NodeServices.layer,
		Layer.succeed(HttpClient.HttpClient, provider),
		Layer.succeed(FetchHttpClient.Fetch, fetchUpstream),
		ConfigProvider.layer(
			ConfigProvider.fromUnknown({
				...Boolean.match(local, {onFalse: () => ({AUTH_URL, GITHUB_ADMINS: '42'}), onTrue: () => ({})}),
				APP_URL: origin
			})
		)
	)
	const auth = layerAuth(verified)
	const clockLayer = Layer.succeed(Clock.Clock, clock)
	// One set of services for both transports: an RPC add and the MCP endpoint share the same registry.
	const services = yield* Layer.buildWithMemoMap(
		pipe(
			Gateway.layer,
			Layer.provideMerge(Layer.mergeAll(Connections.layer, AiProxy.layer)),
			Layer.provide(McpServer.McpServer.layer),
			Layer.provide(store),
			Layer.provide(platform),
			Layer.provideMerge(auth),
			Layer.provideMerge(clockLayer)
		),
		memoMap,
		scope
	)
	const rpc = yield* Layer.buildWithMemoMap(
		Layer.provideMerge(RpcHandlers, Layer.succeedContext(services)),
		memoMap,
		scope
	)
	const client = yield* Effect.provideContext(RpcTest.makeClient(RpcContracts, {flatten: true}), rpc)
	const web = yield* Effect.acquireRelease(
		Effect.sync(() =>
			HttpRouter.toWebHandler(
				pipe(
					Layer.mergeAll(AiHttpHandlers, HttpHandlers, GatewayMcp),
					Layer.provideMerge(Layer.succeedContext(services)),
					Layer.provide(store),
					Layer.provide(platform),
					Layer.provideMerge(auth),
					Layer.provideMerge(clockLayer)
				),
				{disableLogger: true, memoMap}
			)
		),
		handler => Effect.promise(() => handler.dispose())
	)
	return {
		add: (url: string) => client('connections.add', {url}, {headers: {cookie: SESSION}}),
		addFailure: (url: string, session: string = SESSION) =>
			Effect.flip(client('connections.add', {url}, {headers: {cookie: session}})),
		challengeMethods,
		client,
		discovered: () =>
			Effect.flatMap(
				Stream.runHead(
					Stream.filter(client('connections.watch', undefined, {headers: {cookie: SESSION}}), rows =>
						Array.every(rows, row => row.status !== 'Connected' || row.tools > 0)
					)
				),
				Effect.fromOption
			),
		discoveryDelay,
		grants,
		keys: (session: string) => client('ai-proxy.list', undefined, {headers: {cookie: session}}),
		list: (session: string = SESSION) =>
			Effect.flatMap(
				Stream.runHead(client('connections.watch', undefined, {headers: {cookie: session}})),
				Effect.fromOption
			),
		metadataUnavailable,
		pauseReject,
		providerName,
		refuseRefresh,
		registrations,
		rejectAccess,
		rejectContinue,
		rejectReady,
		remove: (id: string, session: string = SESSION) =>
			Context.get(rpc, Connections).remove(
				id,
				Option.getOrThrow(Option.fromUndefinedOr(ACCOUNTS[String.replace(/^session=/u, '')(session)]))
			),
		sessions,
		setKey: (session: string, aiProvider: AiProvider, secret: string) =>
			client('ai-proxy.setKey', {provider: aiProvider, secret: Redacted.make(secret)}, {headers: {cookie: session}}),
		sql: Context.get(database, SqlClient.SqlClient),
		stall,
		stallReady,
		toolNames,
		upstreamRequests,
		upstreamTools,
		verified,
		web
	}
})

function send(web: Effect.Success<ReturnType<typeof servers>>['web'], path: string, init?: RequestInit) {
	return Effect.promise(() => web.handler(new Request(new URL(path, GATEWAY_URL), init)))
}

function cookie(response: Response) {
	return pipe(
		response.headers.getSetCookie(),
		Array.map(value => Array.headNonEmpty(String.split(value, ';'))),
		Array.join('; ')
	)
}

const connect = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['web'],
	id: string,
	answer: Record<string, string>
) {
	const start = yield* send(web, `/oauth/connect?id=${id}`, {headers: {cookie: SESSION}})
	return yield* send(
		web,
		`/oauth/callback/${id}?${new URLSearchParams({...answer, state: new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? ''})}`,
		{headers: {cookie: `${SESSION}; ${cookie(start)}`}}
	)
})

const callTool = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['web'],
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

const modern = Effect.fnUntraced(function* (
	web: Effect.Success<ReturnType<typeof servers>>['web'],
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

const toolsOf = Effect.fnUntraced(function* (web: Effect.Success<ReturnType<typeof servers>>['web'], token: string) {
	const response = yield* modern(web, token, 'tools/list')
	return (yield* Schema.decodeEffect(
		Schema.fromJsonString(Schema.Struct({result: Schema.Struct({tools: Schema.Array(McpSchema.Tool)})}))
	)(yield* Effect.promise(() => response.text()))).result.tools
})

it.layer(Layer.merge(NodeCrypto.layer, NodeServices.layer))(test => {
	test.effect(
		'keeps live authorizations when unknown callbacks arrive and exchanges a state only once',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* gateway.add(PROVIDERS.mobbin.url)
			const start = yield* send(gateway.web, '/oauth/connect?id=mobbin', {headers: {cookie: SESSION}})
			const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? ''
			for (const index of Array.range(0, 64)) {
				const unknown = `unknown-${index}`
				yield* send(
					gateway.web,
					`/oauth/callback/mobbin?state=${unknown}&code=approved&iss=${encodeURIComponent(PROVIDERS.mobbin.issuer)}`,
					{headers: {cookie: `${SESSION}; __Host-mcp-${unknown}=${unknown}`}}
				)
			}
			const callback = `/oauth/callback/mobbin?state=${state}&code=approved&iss=${encodeURIComponent(PROVIDERS.mobbin.issuer)}`
			yield* Effect.all(
				[
					send(gateway.web, callback, {headers: {cookie: `${SESSION}; ${cookie(start)}`}}),
					send(gateway.web, callback, {headers: {cookie: `${SESSION}; ${cookie(start)}`}})
				],
				{concurrency: 'unbounded'}
			)
			assert.strictEqual(gateway.grants.length, 1)
		})
	)
	test.effect(
		'shows fresh discovery failures on the connection and recovers on the next attempt',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* gateway.add(PROVIDERS.mobbin.url)
			yield* Ref.set(gateway.metadataUnavailable, true)
			const response = yield* send(gateway.web, '/oauth/connect?id=mobbin', {headers: {cookie: SESSION}})
			assert.strictEqual(response.status, 302)
			assert.strictEqual(response.headers.get('location'), '/')
			assert.isTrue(
				pipe(
					Array.head(yield* gateway.list()),
					Option.flatMap(server => server.error),
					Option.exists(String.isNonEmpty)
				)
			)
			assert.strictEqual(gateway.registrations.length, 0)
			assert.strictEqual(gateway.grants.length, 0)
			yield* Ref.set(gateway.metadataUnavailable, false)
			assert.include(
				(yield* send(gateway.web, '/oauth/connect?id=mobbin', {headers: {cookie: SESSION}})).headers.get('location') ??
					'',
				'code_challenge_method=S256'
			)
		})
	)
	test.effect(
		'refuses authorization unless the provider currently advertises S256 PKCE',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* gateway.add(PROVIDERS.mobbin.url)
			for (const methods of [Option.none<string[]>(), Option.some(['plain'])]) {
				yield* Ref.set(gateway.challengeMethods, methods)
				const response = yield* send(gateway.web, '/oauth/connect?id=mobbin', {headers: {cookie: SESSION}})
				assert.strictEqual(response.status, 302)
				assert.strictEqual(response.headers.get('location'), '/')
				assert.isTrue(
					Option.exists(
						Option.flatMap(Array.head(yield* gateway.list()), server => server.error),
						String.includes('S256 PKCE')
					)
				)
				assert.strictEqual(gateway.registrations.length, 0)
			}
			yield* Ref.set(gateway.challengeMethods, Option.some(['S256']))
			assert.include(
				(yield* send(gateway.web, '/oauth/connect?id=mobbin', {headers: {cookie: SESSION}})).headers.get('location') ??
					'',
				'code_challenge_method=S256'
			)
		})
	)
	test.effect(
		'uses the local trusted developer without production admin configuration',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers(undefined, 'http://127.0.0.1:5000', true)
			assert.strictEqual(
				(yield* gateway.client(
					'connections.add',
					{url: 'https://public.example.com/mcp'},
					{headers: {cookie: 'session=dev'}}
				)).status,
				'Connected'
			)
		})
	)
	test.effect(
		'uses an alternate canonical origin for OAuth, client metadata, self checks and forwarded audiences',
		Effect.fnUntraced(function* () {
			const origin = 'https://gateway.example.com'
			const gateway = yield* servers(undefined, origin)
			const metadata = yield* send(gateway.web, '/oauth/client.json')
			const document = yield* Schema.decodeEffect(
				Schema.fromJsonString(Schema.Struct({client_id: Schema.String, redirect_uris: Schema.Array(Schema.String)}))
			)(yield* Effect.promise(() => metadata.text()))
			assert.strictEqual(document.client_id, `${origin}/oauth/client.json`)
			assert.deepStrictEqual(document.redirect_uris, [`${origin}/oauth/callback`])
			const added = yield* gateway.add(PROVIDERS.mobbin.url)
			assert.strictEqual(
				new URL(
					(yield* send(gateway.web, `/oauth/connect?id=${added.id}`, {headers: {cookie: SESSION}})).headers.get(
						'location'
					) ?? ''
				).searchParams.get('redirect_uri'),
				`${origin}/oauth/callback/${added.id}`
			)
			assert.isTrue(Schema.is(AuthError)(yield* gateway.addFailure(`${origin}/mcp`)))
			const publicServer = yield* gateway.add('https://public.example.com/mcp')
			yield* modern(gateway.web, TOKEN, 'tools/list')
			const verifiedBefore = yield* Ref.get(gateway.verified)
			const called = yield* modern(gateway.web, TOKEN, 'tools/call', {
				arguments: {query: 'alternate-origin'},
				name: `${publicServer.id}__search`
			})
			assert.strictEqual(called.status, 200)
			assert.include(yield* Effect.promise(() => called.text()), 'alternate-origin')
			assert.strictEqual((yield* Ref.get(gateway.verified)) - verifiedBefore, 1)
		})
	)
	test.effect(
		'discovers challenge-only metadata and authorizes with a client metadata document only when the answer names its issuer',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			const added = yield* gateway.add('https://challenge.example.com/mcp')
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
			assert.deepStrictEqual(
				pipe(
					MutableList.toArray(gateway.grants),
					Array.filter(grant => grant.grant === 'authorization_code'),
					Array.map(grant => grant.resource)
				),
				['https://challenge.example.com/mcp']
			)
			yield* gateway.addFailure('https://silent.example.com/mcp')
			assert.deepStrictEqual(
				Array.map(yield* gateway.list(), server => server.id),
				[added.id]
			)
		})
	)
	test.effect(
		'encodes unsafe tool names and keeps vanished and removed tools out of lists and calls',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* Ref.set(gateway.toolNames, ['search.docs', 'search_docs', 'search__encoded_literal'])
			const added = yield* gateway.add('https://public.example.com/mcp')
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
			yield* TestClock.adjust('30 seconds')
			// The list is answered from the current registry; the changed set arrives behind it.
			yield* modern(gateway.web, TOKEN, 'tools/list')
			yield* Effect.flatMap(
				Stream.runHead(
					Stream.filter(gateway.client('connections.watch', undefined, {headers: {cookie: SESSION}}), rows =>
						Array.some(rows, row => row.id === added.id && row.tools === 1)
					)
				),
				Effect.fromOption
			)
			assert.deepStrictEqual(yield* listed(), [`${added.id}__search_docs`])
			const vanished = yield* modern(gateway.web, TOKEN, 'tools/call', {arguments: {query: 'gone'}, name: encoded})
			assert.isTrue(String.includes('error')(yield* Effect.promise(() => vanished.text())))
			yield* gateway.remove(added.id)
			yield* modern(gateway.web, TOKEN, 'tools/list')
			assert.deepStrictEqual(yield* listed(), [])
		})
	)
	test.effect(
		'answers tools/list from the registry without awaiting a slow discovery',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* Ref.set(gateway.discoveryDelay, 1500)
			const added = yield* gateway.add('https://public.example.com/mcp')
			const timings = MutableList.make<number>()
			const listings = MutableList.make<readonly McpSchema.Tool[]>()
			for (const _ of Array.range(1, 5)) {
				const [duration, tools] = yield* TestClock.withLive(Effect.timed(toolsOf(gateway.web, TOKEN)))
				MutableList.append(timings, Duration.toMillis(duration))
				MutableList.append(listings, tools)
			}
			assert.isBelow(Option.getOrThrow(pipe(MutableList.toArray(timings), Array.sort(Order.Number), Array.get(2))), 100)
			assert.isTrue(
				Array.some(
					Option.getOrThrow(Array.last(MutableList.toArray(listings))),
					tool => tool.name === `${added.id}__search`
				)
			)
		})
	)
	test.effect(
		'lists a stored connection’s tools on the first request after a restart',
		Effect.fnUntraced(function* () {
			const home = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			yield* Effect.scoped(
				Effect.gen(function* () {
					const gateway = yield* servers(home)
					yield* gateway.add('https://public.example.com/mcp')
				})
			)
			assert.isTrue(
				Array.some(yield* toolsOf((yield* servers(home)).web, TOKEN), tool => tool.name === 'public__search')
			)
		})
	)
	test.effect(
		'reports a storage failure as temporarily unavailable',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* gateway.setKey(SESSION, 'anthropic', 'sk-octocat')
			yield* gateway.sql`UPDATE ai_keys SET provider = 'retired'`
			const failure = yield* Effect.flip(gateway.keys(SESSION))
			assert.isTrue(Schema.is(AuthError)(failure))
			assert.strictEqual(failure.error, 'temporarily_unavailable')
		})
	)
	test.effect(
		'reports an upstream failure as temporarily unavailable',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* Ref.set(gateway.metadataUnavailable, true)
			const failure = yield* gateway.addFailure('https://public.example.com/mcp')
			assert.isTrue(Schema.is(AuthError)(failure))
			assert.strictEqual(failure.error, 'temporarily_unavailable')
		})
	)
	test.effect(
		'refreshes a changed upstream tool set in the background and notifies its clients',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			const added = yield* gateway.add('https://public.example.com/mcp')
			const client = mcpClient()
			const changed = yield* Deferred.make<void>()
			client.setNotificationHandler('notifications/tools/list_changed', () => {
				Deferred.doneUnsafe(changed, Effect.void)
			})
			const transport = new StreamableHTTPClientTransport(new URL(`${GATEWAY_URL}/mcp`), {
				fetch: (input, init) => gateway.web.handler(new Request(input, init)),
				requestInit: {headers: {authorization: `Bearer ${TOKEN}`}}
			})
			yield* Effect.acquireRelease(
				Effect.promise(() => client.connect(transport)),
				() => Effect.promise(() => client.close())
			)
			yield* Effect.acquireRelease(
				Effect.promise(() => client.listen({toolsListChanged: true})),
				subscription => Effect.promise(() => subscription.close())
			)
			yield* Ref.set(gateway.toolNames, ['search_docs', 'create_doc'])
			yield* TestClock.adjust('30 seconds')
			assert.deepStrictEqual(
				Array.filter(
					Array.map(
						(yield* Effect.promise(() => client.listTools(undefined, {cacheMode: 'bypass'}))).tools,
						tool => tool.name
					),
					String.startsWith(`${added.id}__`)
				),
				[`${added.id}__search`]
			)
			yield* Deferred.await(changed)
			assert.deepStrictEqual(
				Array.sort(
					Array.filter(
						Array.map(
							(yield* Effect.promise(() => client.listTools(undefined, {cacheMode: 'bypass'}))).tools,
							tool => tool.name
						),
						String.startsWith(`${added.id}__`)
					),
					Order.String
				),
				[`${added.id}__create_doc`, `${added.id}__search_docs`]
			)
		})
	)
	test.effect(
		'verifies the bearer once for a request that reads several upstreams',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* gateway.add('https://stash.mp281x.xyz/mcp')
			yield* gateway.add('https://notes.mp281x.xyz/mcp')
			yield* TestClock.adjust('30 seconds')
			yield* Queue.takeAll(gateway.upstreamTools)
			const verified = yield* Ref.get(gateway.verified)
			yield* modern(gateway.web, TOKEN, 'tools/list')
			yield* Queue.take(gateway.upstreamTools)
			yield* Queue.take(gateway.upstreamTools)
			assert.strictEqual((yield* Ref.get(gateway.verified)) - verified, 1)
		})
	)
	test.effect(
		'never retries an old URL with a removed and replaced connection’s credentials',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* gateway.add(PROVIDERS.mobbin.url)
			const approve = connect(gateway.web, 'mobbin', {code: 'approved', iss: PROVIDERS.mobbin.issuer})
			yield* approve
			yield* modern(gateway.web, TOKEN, 'tools/list')
			yield* Ref.set(gateway.rejectAccess, 'Bearer upstream-authorization_code-1')
			yield* Ref.set(gateway.pauseReject, true)
			const pending = yield* Effect.forkScoped(
				modern(gateway.web, TOKEN, 'tools/call', {arguments: {query: 'racing'}, name: 'mobbin__search'})
			)
			yield* Queue.take(gateway.rejectReady)
			yield* gateway.remove('mobbin')
			assert.strictEqual((yield* gateway.add('https://app.mobbin.net/mcp')).id, 'mobbin')
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
			yield* Ref.set(gateway.providerName, '   ')
			assert.deepStrictEqual(yield* gateway.list(), [])
			const publicServer = yield* gateway.add('https://public.example.com/mcp')
			assert.strictEqual(publicServer.name, 'Public')
			assert.strictEqual(publicServer.status, 'Connected')
			assert.strictEqual(publicServer.tools, 1)
			assert.strictEqual(MutableHashMap.size(gateway.sessions), 0)
			const external = yield* gateway.add('https://mcp.example.com/mcp')
			const collision = yield* gateway.add('https://mcp.example.net/mcp')
			assert.strictEqual(external.id, 'example')
			assert.match(collision.id, /^example_[a-z0-9_-]{6}$/u)
			assert.strictEqual(external.status, 'Not connected')
			const before = yield* modern(gateway.web, TOKEN, 'tools/list')
			const beforeText = yield* Effect.promise(() => before.text())
			assert.isTrue(String.includes(`${publicServer.id}__search`)(beforeText))
			assert.isFalse(String.includes('example__search')(beforeText))
			const previousRequests = MutableList.toArray(gateway.upstreamRequests)
			yield* gateway.remove(publicServer.id)
			const stale = yield* modern(gateway.web, TOKEN, 'tools/call', {
				arguments: {query: 'stale definition'},
				name: `${publicServer.id}__search`
			})
			assert.isTrue(String.includes('error')(yield* Effect.promise(() => stale.text())))
			assert.deepStrictEqual(MutableList.toArray(gateway.upstreamRequests), previousRequests)
			assert.strictEqual((yield* gateway.add(publicServer.url)).id, publicServer.id)
			const called = yield* modern(gateway.web, TOKEN, 'tools/call', {
				arguments: {query: 'new definition'},
				name: `${publicServer.id}__search`
			})
			assert.isTrue(String.includes('new definition')(yield* Effect.promise(() => called.text())))
			assert.isTrue(Schema.is(AuthError)(yield* gateway.addFailure(publicServer.url)))
			const stranger = yield* gateway.addFailure('https://another.example.com/mcp', 'session=stranger')
			const self = yield* gateway.addFailure(`${GATEWAY_URL}/mcp`)
			assert.deepStrictEqual(
				[Schema.is(AuthError)(stranger), stranger.error, Schema.is(AuthError)(self), self.error],
				[true, 'access_denied', true, undefined]
			)
			const snapshotText = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Array(ConnectionItem)))(
				yield* gateway.list()
			)
			assert.isFalse(String.includes('access_token')(snapshotText))
			assert.isFalse(String.includes('refresh_token')(snapshotText))
			assert.strictEqual(MutableHashMap.size(gateway.sessions), 0)
		})
	)
	test.effect(
		'counts each proxied tool call in a usage window that moves at the bucket boundary',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			const added = yield* gateway.add('https://public.example.com/mcp')
			yield* modern(gateway.web, TOKEN, 'tools/list')
			const updates = yield* Queue.unbounded<{range: UsageRange; report: McpUsageReport}>()
			yield* pipe(
				gateway.client('connections.usage', '24h', {headers: {cookie: SESSION}}),
				Stream.runForEach(value => Queue.offer(updates, value)),
				Effect.forkScoped
			)
			const first = yield* Queue.take(updates)
			assert.deepStrictEqual(first, {
				range: {count: 24, from: -82_800_000, size: 3_600_000, to: 3_600_000},
				report: [{id: added.id, series: []}]
			})
			for (const index of Array.range(1, 2)) {
				const called = yield* modern(gateway.web, TOKEN, 'tools/call', {
					arguments: {query: `call ${index}`},
					name: `${added.id}__search`
				})
				assert.strictEqual(called.status, 200)
			}
			// An open page hears the burst once, with both calls counted in the same window.
			yield* TestClock.adjust('1 second')
			yield* TestClock.adjust('1 second')
			assert.deepStrictEqual(yield* Queue.take(updates), {
				range: first.range,
				report: [{id: added.id, series: [{at: 0, calls: 2}]}]
			})
			assert.strictEqual(yield* Queue.size(updates), 0)
			// Past the hour boundary, the window moves and a later call still counts.
			yield* TestClock.adjust('1 hour')
			assert.deepStrictEqual((yield* Queue.take(updates)).range, {
				count: 24,
				from: -79_200_000,
				size: 3_600_000,
				to: 7_200_000
			})
			const called = yield* modern(gateway.web, TOKEN, 'tools/call', {
				arguments: {query: 'after the boundary'},
				name: `${added.id}__search`
			})
			assert.strictEqual(called.status, 200)
			yield* TestClock.adjust('1 second')
			yield* TestClock.adjust('1 second')
			assert.deepStrictEqual((yield* Queue.take(updates)).report, [
				{
					id: added.id,
					series: [
						{at: 0, calls: 2},
						{at: 3_600_000, calls: 1}
					]
				}
			])
			// The page's day view sums the same hours into one day.
			const daily = yield* Queue.unbounded<{range: UsageRange; report: McpUsageReport}>()
			yield* pipe(
				gateway.client('connections.usage', '30d', {headers: {cookie: SESSION}}),
				Stream.runForEach(value => Queue.offer(daily, value)),
				Effect.forkScoped
			)
			assert.deepStrictEqual((yield* Queue.take(daily)).report, [{id: added.id, series: [{at: 0, calls: 3}]}])
		})
	)
	test.effect(
		'streams AI usage only to the person whose calls it counts',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* gateway.setKey('session=stranger', 'anthropic', 'sk-stranger')
			const mine = yield* Queue.unbounded<{range: UsageRange; report: AiUsageReport}>()
			const theirs = yield* Queue.unbounded<{range: UsageRange; report: AiUsageReport}>()
			yield* pipe(
				gateway.client('ai-proxy.usage', '24h', {headers: {cookie: SESSION}}),
				Stream.runForEach(value => Queue.offer(mine, value)),
				Effect.forkScoped
			)
			yield* pipe(
				gateway.client('ai-proxy.usage', '24h', {headers: {cookie: 'session=stranger'}}),
				Stream.runForEach(value => Queue.offer(theirs, value)),
				Effect.forkScoped
			)
			assert.deepStrictEqual((yield* Queue.take(mine)).report.byProvider, [])
			assert.deepStrictEqual((yield* Queue.take(theirs)).report.byProvider, [])
			const called = yield* send(gateway.web, '/ai/anthropic/json', {
				body: '{"model":"test"}',
				headers: {authorization: 'Bearer agent.stranger.signature', 'content-type': 'application/json'},
				method: 'POST'
			})
			assert.strictEqual(called.status, 200)
			yield* Effect.promise(() => called.text())
			yield* TestClock.adjust('1 second')
			yield* TestClock.adjust('1 second')
			assert.deepStrictEqual((yield* Queue.take(theirs)).report.byProvider, [
				{costUsd: 0.123, name: 'anthropic', unknownCostCalls: 0}
			])
			// Another person's call never reaches this reader, not even as a tick.
			assert.strictEqual(yield* Queue.size(mine), 0)
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
					yield* gateway.add(PROVIDERS.mobbin.url)
					yield* gateway.add('https://public.example.com/mcp')
					const start = yield* send(gateway.web, '/oauth/connect?id=mobbin', {headers: {cookie: SESSION}})
					const target = new URL(start.headers.get('location') ?? '')
					assert.strictEqual(target.searchParams.get('code_challenge_method'), 'S256')
					assert.strictEqual(target.searchParams.get('tenant'), 'required')
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
						{client: 'client-1', grant: 'authorization_code', refresh: '', resource: PROVIDERS.mobbin.url}
					])
				})
			)
			const gateway = yield* servers(home)
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
					client: 'client-1',
					grant: 'refresh_token',
					refresh: 'refresh-authorization_code-1',
					resource: PROVIDERS.mobbin.url
				}
			])
			yield* Ref.set(gateway.rejectAccess, 'Bearer upstream-refresh_token-1')
			// Calls reach the provider before they answer; a tools/list would only start a read that outlives it and races the stall below.
			yield* Effect.all(
				Array.map([TOKEN, second], token =>
					modern(gateway.web, token, 'tools/call', {arguments: {query: 'rejected'}, name: 'mobbin__search'})
				),
				{concurrency: 'unbounded'}
			)
			assert.deepStrictEqual(
				Array.map(MutableList.toArray(gateway.grants), grant => grant.refresh),
				['refresh-authorization_code-1', 'refresh-refresh_token-1']
			)
			yield* Ref.set(gateway.stall, true)
			yield* TestClock.adjust('30 seconds')
			const slowList = yield* Effect.forkScoped(modern(gateway.web, second, 'tools/list'))
			yield* Queue.take(gateway.stallReady)
			yield* TestClock.adjust('2 seconds')
			const partial = yield* Fiber.join(slowList)
			const partialText = yield* Effect.promise(() => partial.text())
			assert.isTrue(String.includes('list_mcp_connections')(partialText))
			assert.isTrue(String.includes('public__search')(partialText))
			assert.strictEqual((yield* modern(gateway.web, TOKEN, 'tools/list')).status, 200)
			yield* gateway.remove('mobbin')
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
		'forwards the browser and each agent token to a Deslop MCP without connecting',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			const added = yield* gateway.add('https://stash.mp281x.xyz/mcp')
			assert.strictEqual(added.status, 'Connected')
			assert.strictEqual(gateway.registrations.length, 0)
			assert.strictEqual(gateway.grants.length, 0)
			assert.isTrue(
				Array.some(
					MutableList.toArray(gateway.upstreamRequests),
					request => request.authorization === 'Bearer browser-access'
				)
			)
			assert.isTrue(
				String.includes(`${added.id}__search`)(
					yield* Effect.flatMap(modern(gateway.web, TOKEN, 'tools/list'), response =>
						Effect.promise(() => response.text())
					)
				)
			)
			for (const token of [TOKEN, `${TOKEN}-laptop`]) {
				yield* modern(gateway.web, token, 'tools/call', {
					arguments: {query: 'pass-through'},
					name: `${added.id}__search`
				})
				assert.isTrue(
					Array.some(
						MutableList.toArray(gateway.upstreamRequests),
						request => request.method === 'tools/call' && request.authorization === `Bearer ${token}`
					)
				)
			}
			assert.deepStrictEqual(
				pipe(
					yield* gateway.list(),
					Array.filter(server => server.id === added.id),
					Array.map(server => server.icons)
				),
				[[{src: 'https://example.com/icon.png', theme: 'dark'}]]
			)
		})
	)
	test.effect(
		'never sends the caller’s token to a server outside Deslop that names Auth',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			assert.notStrictEqual((yield* gateway.add('https://mimic.example.com/mcp')).status, 'Connected')
			yield* modern(gateway.web, TOKEN, 'tools/list')
			assert.isFalse(
				Array.some(
					MutableList.toArray(gateway.upstreamRequests),
					request => new URL(request.url).hostname === 'mimic.example.com' && String.isNonEmpty(request.authorization)
				)
			)
		})
	)
	test.effect(
		'reads a newly connected server’s tools at once, even while an agent’s read is still running',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* gateway.add(PROVIDERS.mobbin.url)
			yield* connect(gateway.web, 'mobbin', {code: 'approved', iss: PROVIDERS.mobbin.issuer})
			assert.deepStrictEqual(
				Array.map(yield* gateway.list(), server => [server.status, server.tools]),
				[['Connected', 1]]
			)
			yield* Ref.set(gateway.stall, true)
			yield* TestClock.adjust('30 seconds')
			const agent = yield* Effect.forkScoped(modern(gateway.web, TOKEN, 'tools/list'))
			yield* Queue.take(gateway.stallReady)
			function example(ready: (status: string) => boolean) {
				return Effect.flatMap(
					Stream.runHead(
						Stream.filter(gateway.client('connections.watch', undefined, {headers: {cookie: SESSION}}), rows =>
							Array.some(rows, server => server.id === 'example' && ready(server.status))
						)
					),
					Effect.fromOption
				)
			}
			yield* Effect.forkScoped(gateway.add('https://mcp.example.com/mcp'))
			yield* example(() => true)
			const connecting = yield* Effect.forkScoped(
				connect(gateway.web, 'example', {code: 'approved', iss: PROVIDERS.mobbin.issuer})
			)
			// The connection's own steps time out at 20 seconds, so the clock moves only once they are done and its tools read waits for the stalled one.
			yield* example(status => status === 'Connected')
			yield* Ref.set(gateway.stall, false)
			yield* TestClock.adjust('21 seconds')
			yield* Fiber.join(connecting)
			yield* Fiber.join(agent)
			assert.deepStrictEqual(
				Array.map(yield* gateway.discovered(), server => [server.id, server.tools]),
				[
					['mobbin', 1],
					['example', 1]
				]
			)
		})
	)
	test.effect(
		'keeps a working connection and its client when a reconnect is abandoned',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* gateway.add(PROVIDERS.mobbin.url)
			yield* connect(gateway.web, 'mobbin', {code: 'approved', iss: PROVIDERS.mobbin.issuer})
			yield* modern(gateway.web, TOKEN, 'tools/list')
			yield* send(gateway.web, '/oauth/connect?id=mobbin', {headers: {cookie: SESSION}})
			assert.strictEqual(gateway.registrations.length, 2)
			yield* TestClock.adjust('40 seconds')
			const called = yield* modern(gateway.web, TOKEN, 'tools/call', {
				arguments: {query: 'still connected'},
				name: 'mobbin__search'
			})
			assert.isTrue(String.includes('still connected')(yield* Effect.promise(() => called.text())))
			assert.deepStrictEqual(
				Array.map(MutableList.toArray(gateway.grants), grant => `${grant.grant}:${grant.client}`),
				['authorization_code:client-1', 'refresh_token:client-1']
			)
		})
	)
	test.effect(
		'does not retain the previous account’s refresh token when a new authorization omits one',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* gateway.add(PROVIDERS.mobbin.url)
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
			const ready = yield* Queue.make<true>()
			const updates = yield* pipe(
				gateway.client('connections.watch', undefined, {headers: {cookie: SESSION}}),
				Stream.tap(() => Queue.offer(ready, true)),
				Stream.take(2),
				Stream.runCollect,
				Effect.forkScoped
			)
			yield* Queue.take(ready)
			// The list is read again each minute, so the token's end at 30 seconds shows by the next read.
			yield* TestClock.adjust('61 seconds')
			assert.deepStrictEqual(
				Array.map(Array.fromIterable(yield* Fiber.join(updates)), snapshot =>
					Array.map(snapshot, server => server.status)
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
			yield* gateway.add(PROVIDERS.mobbin.url)
			yield* connect(gateway.web, 'mobbin', {code: 'missing-issuer'})
			assert.strictEqual(gateway.grants.length, 0)
			assert.strictEqual(
				(yield* send(gateway.web, '/oauth/connect?id=mobbin', {headers: {cookie: 'session=stranger'}})).headers.get(
					'location'
				),
				'/'
			)
			assert.strictEqual(
				(yield* send(gateway.web, '/oauth/connect?id=mobbin')).headers.get('location'),
				`https://gateway.mp281x.xyz/auth/sign-in?${new URLSearchParams({next: 'https://gateway.mp281x.xyz/oauth/connect?id=mobbin'})}`
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
			assert.deepStrictEqual(
				Array.map(yield* gateway.list(), server => Option.getOrUndefined(server.error)),
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
			assert.isTrue(Schema.is(AuthError)(yield* gateway.addFailure(PROVIDERS.dual.url)))
			const denied = yield* Effect.flip(gateway.remove('mobbin', 'session=stranger'))
			assert.deepStrictEqual([Schema.is(AuthError)(denied), denied.error], [true, 'access_denied'])
		})
	)
	test.effect(
		'removes a shared MCP server through the MCP tool only as an admin',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			const first = yield* gateway.add('https://public.example.com/mcp')
			const second = yield* gateway.add('https://mcp.example.com/mcp')
			const denied = yield* callTool(gateway.web, 'agent.stranger.signature', 'remove_mcp_server', {server: first.id})
			assert.include(yield* Effect.promise(() => denied.text()), 'Only an admin can manage MCP servers')
			assert.deepStrictEqual(
				Array.map(yield* gateway.list(), server => server.id),
				[first.id, second.id]
			)
			assert.strictEqual((yield* callTool(gateway.web, TOKEN, 'remove_mcp_server', {server: first.id})).status, 200)
			assert.deepStrictEqual(
				Array.map(yield* gateway.list(), server => server.id),
				[second.id]
			)
			const unknown = yield* callTool(gateway.web, TOKEN, 'remove_mcp_server', {server: 'ghost'})
			assert.include(yield* Effect.promise(() => unknown.text()), 'This MCP was removed')
		})
	)
	test.effect(
		'removes only the caller’s own AI key through the MCP tool',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* gateway.setKey(SESSION, 'anthropic', 'sk-octocat')
			yield* gateway.setKey('session=stranger', 'anthropic', 'sk-stranger')
			assert.deepStrictEqual(
				Array.map(yield* gateway.keys(SESSION), key => key.last4),
				['ocat']
			)
			assert.strictEqual((yield* callTool(gateway.web, TOKEN, 'remove_ai_key', {provider: 'anthropic'})).status, 200)
			assert.deepStrictEqual(yield* gateway.keys(SESSION), [])
			assert.deepStrictEqual(
				Array.map(yield* gateway.keys('session=stranger'), key => key.last4),
				['nger']
			)
			assert.strictEqual((yield* callTool(gateway.web, '', 'remove_ai_key', {provider: 'anthropic'})).status, 401)
		})
	)
	test.effect(
		'shows a connection as expired once its provider refuses to renew it',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			yield* gateway.add(PROVIDERS.mobbin.url)
			yield* connect(gateway.web, 'mobbin', {code: 'approved', iss: PROVIDERS.mobbin.issuer})
			yield* modern(gateway.web, TOKEN, 'tools/list')
			yield* Ref.set(gateway.refuseRefresh, true)
			// Past its renewal margin the call spends the refresh token, which the provider refuses.
			yield* TestClock.adjust('40 seconds')
			yield* modern(gateway.web, TOKEN, 'tools/call', {arguments: {query: 'renew'}, name: 'mobbin__search'})
			assert.deepStrictEqual(
				Array.map(MutableList.toArray(gateway.grants), grant => grant.grant),
				['authorization_code', 'refresh_token']
			)
			yield* TestClock.adjust('21 seconds')
			assert.deepStrictEqual(
				Array.map(yield* gateway.list(), server => server.status),
				['Expired']
			)
		})
	)
	test.effect(
		'drops an hour of calls or AI usage older than the longest period as a new call arrives',
		Effect.fnUntraced(function* () {
			const gateway = yield* servers()
			const added = yield* gateway.add('https://public.example.com/mcp')
			yield* gateway.setKey('session=stranger', 'anthropic', 'sk-stranger')
			const calls = Effect.gen(function* () {
				yield* modern(gateway.web, TOKEN, 'tools/call', {arguments: {query: 'hour'}, name: `${added.id}__search`})
				const response = yield* send(gateway.web, '/ai/anthropic/json', {
					body: '{"model":"test"}',
					headers: {authorization: 'Bearer agent.stranger.signature', 'content-type': 'application/json'},
					method: 'POST'
				})
				yield* Effect.promise(() => response.text())
			})
			const hours = Effect.gen(function* () {
				const recorded = yield* gateway.sql<{hour: number}>`
					SELECT hour FROM connection_calls UNION ALL SELECT hour FROM ai_usage ORDER BY hour
				`
				return Array.map(recorded, row => row.hour)
			})
			const hour = Effect.map(Clock.currentTimeMillis, now => Math.floor(now / 3_600_000) * 3_600_000)
			yield* modern(gateway.web, TOKEN, 'tools/list')
			const first = yield* hour
			yield* calls
			yield* TestClock.adjust('1 second')
			assert.deepStrictEqual(yield* hours, [first, first])
			yield* TestClock.adjust('31 days')
			const later = yield* hour
			yield* calls
			yield* TestClock.adjust('1 second')
			assert.deepStrictEqual(yield* hours, [later, later])
		})
	)
})
