import {NodeHttpClient, NodeSocket} from '@effect/platform-node'

import {
	Array,
	Arbitrary,
	Boolean,
	Cause,
	ConfigProvider,
	Console,
	Context,
	Effect,
	FileSystem,
	Function,
	Inspectable,
	Layer,
	Option,
	Predicate,
	Record,
	Ref,
	Result,
	Schema,
	SchemaGetter,
	Stream,
	String,
	pipe
} from 'effect'

import type {Toolkit} from 'effect/ai'
import {HttpClient, HttpClientRequest, HttpClientResponse, HttpMethod, HttpRouter, HttpServer} from 'effect/http'
import {Rpc, RpcClient, RpcGroup, RpcSchema, RpcSerialization} from 'effect/rpc'

import {Auth} from '#server/auth.ts'
import {appName} from '#server/package.ts'
import {AuthError, UserId} from '#shared/auth.ts'
import type {RpcAdmin, RpcAuth} from '#shared/auth.ts'
import {Account, MCP_PATH} from '#shared/schema.ts'

// Opaque URL checks and minimum-length APNs tokens need explicit, contract-validated examples instead of small arbitrary strings.
const FIXED_INPUTS: Record<string, unknown> = {
	'gateway connections.add': {url: 'https://example.com/mcp'},
	'opm push.register': {bundle: 'xyz.mp281x.opm.dev', kind: 'alert', token: '00000000000000000000000000000000'},
	'trips push.register': {bundle: 'xyz.mp281x.trips.dev', kind: 'alert', token: '00000000000000000000000000000000'}
}

type Caller = typeof Caller.Type
const Caller = Schema.Literals(['anonymous', 'member'])

type Identity = typeof Identity.Type
const Identity = Schema.Union([Caller, Schema.Literals(['admin'])])

type ProbeRpc = {readonly name: string; readonly contract: Rpc.AnyWithProps}

type Route = {readonly method: string; readonly path: string}
type ProbeTool = {readonly name: string; readonly parametersSchema: Schema.Top}

// Only the probe command provides this service; normal servers neither collect inventories nor accept fixture identities.
export class AuthorizationProbe extends Context.Service<
	AuthorizationProbe,
	{
		readonly directory: string
		readonly routes: Ref.Ref<readonly Route[]>
		readonly rpcs: Ref.Ref<readonly ProbeRpc[]>
		readonly tools: Ref.Ref<readonly ProbeTool[]>
	}
>()('@deslop/runtime/server/probe/AuthorizationProbe') {}

type Access = {
	readonly app: string
	readonly callers: readonly Identity[]
	// Why the probe's fabricated request is refused even for an admitted caller; without a reason, admission is asserted.
	readonly refusesProbe?: string
	readonly surface: string
}

// Member APIs admit a person, not an anonymous caller; every unnamed surface must refuse both. An admin entry names a scratch-safe admin operation the probe runs as admin.
const publicAccess: readonly Access[] = [
	...Array.map(
		[
			'GET /api/runtime',
			'GET /icon',
			'GET /favicon.ico',
			'GET /manifest.webmanifest',
			'GET /assets/*',
			'GET /*',
			'GET /api/rpc',
			'GET /auth/sign-in',
			'POST /auth/sign-out'
		],
		surface => ({app: '*', callers: Caller.literals, surface: `http ${surface}`})
	),
	{app: '*', callers: ['member'], surface: 'http GET /api/account'},
	...Array.map(['POST /mcp', 'GET /mcp', 'DELETE /mcp', 'PUT /mcp', 'PATCH /mcp', 'OPTIONS /mcp'], surface => ({
		app: '*',
		callers: ['member'] as const,
		surface: `http ${surface}`
	})),
	{app: 'auth', callers: Caller.literals, surface: 'http GET /.well-known/apple-app-site-association'},
	...Array.map(['GET /sign-in', 'POST /sign-out'], surface => ({
		app: 'auth',
		callers: Caller.literals,
		refusesProbe: "Auth returns only to an HTTPS page under its domain, which the probe's loopback origin is not",
		surface: `http ${surface}`
	})),
	{
		app: 'auth',
		callers: Caller.literals,
		refusesProbe: 'GitHub returns only to a login state Auth issued',
		surface: 'http GET /auth/github/callback'
	},
	{
		app: 'auth',
		callers: Caller.literals,
		refusesProbe: 'Auth names its own caller from real credentials, which fixture identities lack',
		surface: 'rpc people.account'
	},
	{app: 'auth', callers: ['member'], surface: 'rpc sessions.watch'},
	...Array.map(['list_sessions', 'sign_out_session'], name => ({
		app: 'auth',
		callers: ['member'] as const,
		surface: `tool ${name}`
	})),
	...Array.map(['metrics.watch', 'metrics.history', 'inventory.watch', 'inventory.snapshot'], name => ({
		app: 'deploy',
		callers: ['member'] as const,
		surface: `rpc ${name}`
	})),
	...Array.map(['list_apps', 'read_resource_history'], name => ({
		app: 'deploy',
		callers: ['member'] as const,
		surface: `tool ${name}`
	})),
	// A peer's admin removes an exposure it owns; on scratch data there is none, so nothing changes.
	{app: 'deploy', callers: ['admin'], surface: 'rpc exposures.remove'},
	...Array.map(['ai-proxy.key', 'ai-proxy.setKey', 'ai-metering.usage'], name => ({
		app: 'gateway',
		callers: ['member'] as const,
		surface: `rpc ${name}`
	})),
	...Array.map(['list_mcp_connections', 'remove_ai_key'], name => ({
		app: 'gateway',
		callers: ['member'] as const,
		surface: `tool ${name}`
	})),
	{app: 'gateway', callers: Caller.literals, surface: 'http GET /oauth/client.json'},
	{app: 'gateway', callers: ['member'], surface: 'http * /ai/*'},
	...Array.map(['chapters.events', 'push.register', 'chapters.write'], name => ({
		app: 'opm',
		callers: ['member'] as const,
		surface: `rpc ${name}`
	})),
	...Array.map(['presence.join', 'presence.move', 'presence.recolor'], name => ({
		app: 'portfolio',
		callers: Caller.literals,
		surface: `rpc ${name}`
	})),
	...Array.map(['POST /v1/traces', 'POST /v1/logs', 'OPTIONS /v1/*'], surface => ({
		app: 'scope',
		callers: Caller.literals,
		surface: `http ${surface}`
	})),
	{
		app: 'scope',
		callers: Caller.literals,
		refusesProbe: "GitHub's webhook needs the shared secret's signature",
		surface: 'http POST /v1/github'
	},
	...Array.map(['telemetry.watch', 'telemetry.trace'], name => ({
		app: 'scope',
		callers: ['member'] as const,
		surface: `rpc ${name}`
	})),
	...Array.map(
		['list_operations', 'search_traces', 'read_trace', 'search_logs', 'measure_latency', 'check_ingestion'],
		name => ({app: 'scope', callers: ['member'] as const, surface: `tool ${name}`})
	),
	...Array.map(
		['POST /api/capture', 'POST /api/files/:id', 'GET /api/images/:id', 'GET /api/notes/:id/media/:index'],
		surface => ({app: 'stash', callers: ['member'] as const, surface: `http ${surface}`})
	),
	...Array.map(
		['notes.events', 'notes.body', 'notes.media', 'notes.search', 'notes.capture', 'notes.regenerate', 'notes.remove'],
		name => ({app: 'stash', callers: ['member'] as const, surface: `rpc ${name}`})
	),
	...Array.map(['search_notes', 'read_note', 'save_note', 'remove_note'], name => ({
		app: 'stash',
		callers: ['member'] as const,
		surface: `tool ${name}`
	})),
	{app: 'trips', callers: ['member'], surface: 'http POST /share'},
	...Array.map(['flights.events', 'flights.save', 'flights.remove', 'tracking.refresh', 'push.register'], name => ({
		app: 'trips',
		callers: ['member'] as const,
		surface: `rpc ${name}`
	}))
]

function accessOf(app: string, surface: string, identity: Identity) {
	return Array.findFirst(
		publicAccess,
		entry =>
			(entry.app === '*' || entry.app === app) && entry.surface === surface && Array.contains(entry.callers, identity)
	)
}

export const layerProbeRouter = Layer.effect(
	HttpRouter.HttpRouter,
	Effect.gen(function* () {
		const router = yield* HttpRouter.HttpRouter
		return Option.match(yield* Effect.serviceOption(AuthorizationProbe), {
			onNone: () => router,
			onSome: probe => {
				function capture(current: HttpRouter.HttpRouter, prefix: string): HttpRouter.HttpRouter {
					return HttpRouter.HttpRouter.of({
						...current,
						add: Effect.fnUntraced(function* (method, path, handler, options) {
							yield* Ref.update(probe.routes, routes => Array.append(routes, {method, path: `${prefix}${path}`}))
							return yield* current.add(method, path, handler, options)
						}),
						addAll: Effect.fnUntraced(function* (routes) {
							yield* Ref.update(probe.routes, saved =>
								Array.appendAll(
									saved,
									Array.map(routes, route => ({method: route.method, path: `${prefix}${route.path}`}))
								)
							)
							return yield* current.addAll(routes)
						}),
						prefixed: path => capture(current.prefixed(path), `${prefix}${path}`)
					})
				}
				return capture(router, '')
			}
		})
	})
)

export function recordRpcContracts<Rpcs extends Rpc.AnyWithProps>(group: RpcGroup.RpcGroup<Rpcs>) {
	return Effect.gen(function* () {
		yield* Option.match(yield* Effect.serviceOption(AuthorizationProbe), {
			onNone: () => Effect.void,
			onSome: active =>
				Ref.update(active.rpcs, saved =>
					Array.appendAll(
						saved,
						// oxlint-disable-next-line @deslop/coding-standards/no-native-method-call -- RpcGroup publishes its definitions as a native ReadonlyMap.
						Array.map(Array.fromIterable(group.requests.entries()), entry => ({contract: entry[1], name: entry[0]}))
					)
				)
		})
	})
}

export function recordToolContracts(contracts: Toolkit.Any) {
	return Effect.gen(function* () {
		yield* Option.match(yield* Effect.serviceOption(AuthorizationProbe), {
			onNone: () => Effect.void,
			onSome: Effect.fnUntraced(function* (active) {
				const tools = yield* Effect.forEach(
					Record.values(contracts.tools),
					tool =>
						Effect.gen(function* () {
							return {
								name: yield* Schema.decodeUnknownEffect(Schema.String)(tool.name),
								parametersSchema: tool.parametersSchema
							}
						}),
					{concurrency: 1}
				)
				yield* Ref.update(active.tools, saved => Array.appendAll(saved, tools))
			})
		})
	})
}

class ProbeError extends Schema.TaggedError<ProbeError>()('ProbeError', {message: Schema.String}) {}

function fail(message: string) {
	return ProbeError.make({message})
}

function sample(schema: Schema.Top, name: string) {
	return Effect.mapError(
		Effect.gen(function* () {
			const input = yield* pipe(
				FIXED_INPUTS,
				Record.get(name),
				Option.match({
					onNone: () =>
						Effect.flatMap(
							Arbitrary.sampleEffect(Arbitrary.schema(Schema.toEncoded(schema)), {count: 1, seed: 1, size: 2}),
							values => Effect.fromOption(Array.head(values))
						),
					onSome: Effect.succeed
				})
			)
			return yield* Schema.decodeUnknownEffect(Schema.toEncoded(schema))(input)
		}),
		error => fail(`${name}: cannot generate a contract-valid input: ${Inspectable.toStringUnknown(error)}`)
	)
}

function rpcFailureCodec(rpc: Rpc.AnyWithProps) {
	return pipe(
		Schema.toEncoded(Rpc.exitSchema(rpc).error),
		Schema.decodeTo(Schema.toType(Schema.Union([AuthError, ProbeError])), {
			decode: SchemaGetter.transform(error =>
				Option.match(Schema.decodeUnknownOption(AuthError)(error), {
					onNone: () => fail(`RPC domain failure: ${Inspectable.toStringUnknown(error)}`),
					onSome: Function.identity<AuthError>
				})
			),
			encode: SchemaGetter.forbidden(Function.constant('Probe clients only decode RPC failures'))
		})
	)
}

type ToolList = typeof ToolList.Type
const ToolList = Schema.Struct({result: Schema.Struct({tools: Schema.Array(Schema.Struct({name: Schema.String}))})})
type ToolResult = typeof ToolResult.Type
const ToolResult = Schema.Struct({
	result: Schema.Struct({
		content: Schema.Array(Schema.Struct({text: Schema.optionalKey(Schema.String), type: Schema.String})),
		isError: Schema.optionalKey(Schema.Boolean)
	})
})

function mcpRequest(origin: string, caller: string, method: string, params: Record<string, unknown>) {
	return pipe(
		HttpClientRequest.post(`${origin}/mcp`),
		HttpClientRequest.setHeaders({
			accept: 'application/json, text/event-stream',
			'mcp-method': method,
			'mcp-name': pipe(
				params['name'],
				Option.liftPredicate(Predicate.isString),
				Option.getOrElse(Function.constant(''))
			),
			'mcp-protocol-version': '2026-07-28',
			'x-probe-caller': caller
		}),
		HttpClientRequest.bodyJson({
			id: 1,
			jsonrpc: '2.0',
			method,
			params: {
				...params,
				_meta: {
					'io.modelcontextprotocol/clientCapabilities': {},
					'io.modelcontextprotocol/protocolVersion': '2026-07-28'
				}
			}
		}),
		Effect.flatMap(HttpClient.execute),
		Effect.flatMap(response => Effect.map(response.text, text => ({status: response.status, text})))
	)
}

const fixtureAuth = Layer.succeedContext(
	Auth.makeContext(headers => {
		const caller = headers['x-probe-caller']
		if (caller === 'admin' || caller === 'member') {
			return Effect.succeed({
				admin: caller === 'admin',
				id: UserId.make(
					`github:${Boolean.match(caller === 'admin', {onFalse: Function.constant(2), onTrue: Function.constant(1)})}`
				),
				name: caller,
				signOut: false
			})
		}
		return Effect.fail(AuthError.make({message: 'Sign in first'}))
	})
)

// Real routes, handlers and migrations run against fixture identities, isolated configuration and temporary data.
export function probeServer<A, E>(
	start: (auth: Layer.Layer<Auth | RpcAuth | RpcAdmin>) => Layer.Layer<A | HttpServer.HttpServer, E>
) {
	return pipe(
		Effect.gen(function* () {
			const app = yield* appName
			const canonical = 'http://127.0.0.1'
			const probe = AuthorizationProbe.of({
				directory: yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({prefix: `${app}-authorization-`}),
				routes: yield* Ref.make<readonly Route[]>([]),
				rpcs: yield* Ref.make<readonly ProbeRpc[]>([]),
				tools: yield* Ref.make<readonly ProbeTool[]>([])
			})
			const context = yield* pipe(
				start(fixtureAuth),
				Layer.provide(Layer.succeed(AuthorizationProbe, probe)),
				Layer.provide(
					Layer.succeed(
						ConfigProvider.ConfigProvider,
						ConfigProvider.fromUnknown({
							APP_URL: canonical,
							AUTH_URL: 'https://auth.probe.invalid',
							GATEWAY_URL: 'http://127.0.0.1:1',
							GITHUB_ADMINS: '1',
							GITHUB_CLIENT_ID: 'probe',
							GITHUB_CLIENT_SECRET: 'probe',
							GITHUB_WEBHOOK_SECRET: 'probe',
							HOME: probe.directory,
							HOST: '127.0.0.1'
						})
					)
				),
				Layer.build
			)
			const origin = HttpServer.formatAddress(Context.get(context, HttpServer.HttpServer).address)
			for (const identity of ['member', 'admin']) {
				const response = yield* pipe(
					HttpClientRequest.get(`${origin}/api/account`),
					HttpClientRequest.setHeader('x-probe-caller', identity),
					HttpClient.execute
				)
				const account = yield* HttpClientResponse.schemaBodyJson(Account)(response)
				if (response.status !== 200 || account.admin !== (identity === 'admin')) {
					return yield* fail(`${app}: fixture ${identity} was not identified correctly`)
				}
			}
			const routes = yield* Ref.get(probe.routes)
			const rpcs = yield* Ref.get(probe.rpcs)
			const tools = yield* Ref.get(probe.tools)
			if (Array.isReadonlyArrayEmpty(rpcs) || Array.isReadonlyArrayEmpty(routes)) {
				return yield* fail(`${app}: no registered routes or RPC contracts`)
			}
			yield* Console.log(
				`${app}: routes [${pipe(
					routes,
					Array.map(route => `${route.method} ${route.path}`),
					Array.join(', ')
				)}]; RPCs [${pipe(
					rpcs,
					Array.map(rpc => rpc.name),
					Array.join(', ')
				)}]; tools [${pipe(
					tools,
					Array.map(tool => tool.name),
					Array.join(', ')
				)}]`
			)
			if (Array.some(routes, route => route.path === '/mcp')) {
				const listed = yield* Schema.decodeEffect(Schema.fromJsonString(ToolList))(
					(yield* mcpRequest(origin, 'admin', 'tools/list', {})).text
				)
				if (
					!Schema.toEquivalence(Schema.Array(Schema.String))(
						pipe(
							listed.result.tools,
							Array.map(tool => tool.name),
							Array.sort(String.Order)
						),
						pipe(
							tools,
							Array.map(tool => tool.name),
							Array.sort(String.Order)
						)
					)
				) {
					return yield* fail(`${app}: tools/list does not match tool contracts`)
				}
			}
			// Every exception names a surface this app registers, so the inventory changes with its routes.
			const registered = [
				...Array.map(routes, route => `http ${route.method} ${route.path}`),
				...Array.map(rpcs, rpc => `rpc ${rpc.name}`),
				...Array.map(tools, tool => `tool ${tool.name}`)
			]
			yield* pipe(
				publicAccess,
				Array.findFirst(entry => entry.app === app && !Array.contains(registered, entry.surface)),
				Option.match({
					onNone: () => Effect.void,
					onSome: entry => fail(`${app}: publicAccess names ${entry.surface}, which this app does not register`)
				})
			)
			// An unnamed surface must refuse the caller; a named one must admit it unless its entry says why the probe's fabricated request is refused.
			const judge = Effect.fnUntraced(function* (
				surface: string,
				identity: Identity,
				answer: {readonly admitted: boolean; readonly refused: boolean; readonly observed: string}
			) {
				const entry = accessOf(app, surface, identity)
				if (Option.isNone(entry) && !answer.refused) {
					return yield* fail(`${identity} ${surface}: expected refusal, got ${answer.observed}`)
				}
				// A stated reason must still hold, or the entry asserts admission again.
				if (Option.exists(entry, found => (found.refusesProbe === undefined) === !answer.admitted)) {
					return yield* fail(
						`${identity} ${surface}: expected ${Boolean.match(answer.admitted, {onFalse: Function.constant('admission'), onTrue: Function.constant('the refusal its entry explains')})}, got ${answer.observed}`
					)
				}
			})
			function rpcAnswer(rpc: ProbeRpc, identity: Identity) {
				return pipe(
					Effect.gen(function* () {
						const protocol = yield* Layer.build(
							pipe(
								RpcClient.layerProtocolSocket(),
								Layer.provide(NodeSocket.layerWebSocket(`${String.replace('http:', 'ws:')(origin)}/api/rpc`)),
								Layer.provide(RpcSerialization.layerSchemaBinary())
							)
						)
						const answer = yield* Effect.result(
							Effect.provideContext(
								Effect.gen(function* () {
									const input = yield* sample(rpc.contract.payloadSchema, `${app} ${rpc.name}`)
									if (RpcSchema.isStreamSchema(rpc.contract.successSchema)) {
										const client = yield* RpcClient.make(
											RpcGroup.make(
												Rpc.make(rpc.name, {
													error: rpcFailureCodec(rpc.contract),
													payload: Schema.toEncoded(rpc.contract.payloadSchema),
													stream: true,
													success: Schema.toEncoded(rpc.contract.successSchema.success)
												})
											),
											{flatten: true}
										)
										return yield* Stream.runHead(client(rpc.name, input, {headers: {'x-probe-caller': identity}}))
									}
									const client = yield* RpcClient.make(
										RpcGroup.make(
											Rpc.make(rpc.name, {
												error: rpcFailureCodec(rpc.contract),
												payload: Schema.toEncoded(rpc.contract.payloadSchema),
												success: Schema.toEncoded(rpc.contract.successSchema)
											})
										),
										{flatten: true}
									)
									return yield* client(rpc.name, input, {headers: {'x-probe-caller': identity}})
								}),
								protocol
							)
						)
						// A domain failure on empty scratch data is admission; an outage is neither admission nor refusal.
						const authFailure = Option.filter(Result.getFailure(answer), Schema.is(AuthError))
						yield* judge(`rpc ${rpc.name}`, identity, {
							admitted: Option.isNone(authFailure),
							observed: String.slice(0, 500)(Inspectable.toStringUnknown(answer)),
							refused: Option.exists(authFailure, failure => failure.error !== 'temporarily_unavailable')
						})
					}),
					Effect.scoped,
					Effect.tapCause(cause => Console.error(`${app} ${identity} RPC ${rpc.name}: ${Cause.pretty(cause)}`)),
					Effect.timeout('30 seconds')
				)
			}
			for (const caller of Caller.literals) {
				yield* Effect.forEach(
					routes,
					route =>
						Effect.timeout(
							Effect.gen(function* () {
								const path = pipe(
									route.path,
									String.replaceAll(':index', '0'),
									String.replaceAll(/:[a-zA-Z]+/gu, 'probe'),
									String.replaceAll('*', 'probe')
								)
								const methods = Boolean.match(route.method === '*', {
									onFalse: () => Array.filter(Array.fromIterable(HttpMethod.all), method => method === route.method),
									onTrue: () => Array.fromIterable(HttpMethod.all)
								})
								if (Array.isReadonlyArrayEmpty(methods)) return yield* fail(`Unprobed HTTP method ${route.method}`)
								for (const method of methods) {
									// A request comes from the app's own page, so a refusal is authorization's, not the cross-site guard's; MCP refuses pages and answers agents, which send no Origin.
									const response = yield* pipe(
										HttpClientRequest.make(method)(`${origin}${path}`, {
											headers: {
												'x-probe-caller': caller,
												...Boolean.match(route.path === MCP_PATH, {
													onFalse: () => ({origin: canonical, 'sec-fetch-site': 'same-origin'}),
													onTrue: () => ({})
												})
											},
											urlParams: {code: 'probe', id: 'probe', state: 'probe'}
										}),
										HttpClientRequest.bodyText('{}', 'application/json'),
										HttpClient.execute
									)
									const refused =
										response.status === 401 ||
										response.status === 403 ||
										(response.status === 302 &&
											Option.exists(
												Option.liftThrowable(() => new URL(response.headers['location'] ?? '', canonical))(),
												url => url.origin === canonical && url.pathname === '/auth/sign-in'
											))
									yield* judge(`http ${route.method} ${route.path}`, caller, {
										admitted: !refused,
										observed: `${method} ${response.status}`,
										refused
									})
									yield* response.text
								}
							}),
							'30 seconds'
						),
					{concurrency: 1, discard: true}
				)
				yield* Effect.forEach(rpcs, rpc => rpcAnswer(rpc, caller), {concurrency: 1, discard: true})
				yield* Effect.forEach(
					tools,
					tool =>
						Effect.timeout(
							Effect.gen(function* () {
								const response = yield* mcpRequest(origin, caller, 'tools/call', {
									arguments: yield* sample(tool.parametersSchema, `${app} ${tool.name}`),
									name: tool.name
								})
								if (response.status === 401 || response.status === 403) {
									return yield* judge(`tool ${tool.name}`, caller, {
										admitted: false,
										observed: `HTTP ${response.status}`,
										refused: true
									})
								}
								if (response.status !== 200) {
									return yield* fail(
										`${caller} tool ${tool.name}: expected MCP result, got ${response.status}: ${response.text}`
									)
								}
								const answer = yield* Schema.decodeEffect(Schema.fromJsonString(ToolResult))(response.text)
								const refused =
									answer.result.isError === true &&
									Array.some(answer.result.content, content => String.startsWith('Only an admin')(content.text ?? ''))
								yield* judge(`tool ${tool.name}`, caller, {admitted: !refused, observed: response.text, refused})
							}),
							'30 seconds'
						),
					{concurrency: 1, discard: true}
				)
				yield* Console.log(
					`PASS ${app} ${caller}: ${routes.length} routes, ${rpcs.length} RPCs and ${tools.length} tools refuse unless named; named ones admit`
				)
			}
			// Admin sentinels run only scratch-safe operations; other admin surfaces are checked by refusing members.
			const sentinels = Array.filter(rpcs, rpc => Option.isSome(accessOf(app, `rpc ${rpc.name}`, 'admin')))
			yield* Effect.forEach(sentinels, rpc => rpcAnswer(rpc, 'admin'), {concurrency: 1, discard: true})
			if (Array.isReadonlyArrayNonEmpty(sentinels)) {
				yield* Console.log(
					`PASS ${app} admin: ${pipe(
						sentinels,
						Array.map(rpc => rpc.name),
						Array.join(', ')
					)} admitted`
				)
			}
		}),
		Effect.scoped,
		// oxlint-disable-next-line effecttsgo/strict-effect-provide -- This CLI entry point owns the probe's HTTP client and its complete lifetime.
		Effect.provide(NodeHttpClient.layerNodeHttp)
	)
}
