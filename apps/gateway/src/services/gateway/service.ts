import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Context,
	Effect,
	Equal,
	Fiber,
	FiberHandle,
	HashMap,
	HashSet,
	Layer,
	Option,
	RcMap,
	Ref,
	Result,
	Schema,
	Semaphore,
	String,
	Struct,
	pipe
} from 'effect'

import {McpSchema, McpServer} from 'effect/ai'
import {Digest} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {Headers, HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {Auth} from '@deslop/runtime/server/auth'
import {AuthError, ON_BEHALF_HEADER, failureOptions} from '@deslop/runtime/shared/auth'
import {MCP_PATH} from '@deslop/runtime/shared/schema'

import {connectionFailure, describe, serverIcons} from '#services/connections/lib/utils.ts'
import type {ConnectionGeneration, ConnectionState, ServerReference, ServerId} from '#services/connections/schema.ts'
import {Discovery} from '#services/connections/schema.ts'
import {Connections, gatewayUrl} from '#services/connections/service.ts'
import {compact, prunedTools} from '#services/gateway/lib/utils.ts'
import {RemoteTool, RemoteTools, ToolArguments, ToolRequest} from '#services/gateway/schema.ts'
import {Upstreams, upstreamStatus} from '#services/upstreams/service.ts'

const discoveryHeaders = Context.Reference<Headers.Headers>('gateway/DiscoveryHeaders', {
	defaultValue: () => Headers.empty
})
// A listing reads every connection's state once, on its first visibility check, rather than once per tool.
const listingConnections = Context.Reference<Effect.Effect<readonly ConnectionState[]>>('gateway/ListingConnections', {
	defaultValue: () => Effect.succeed([])
})

export class Gateway extends Context.Service<
	Gateway,
	{
		// A connection that was added or re-authorized: its tools are read now, even while another read runs.
		readonly connected: (headers: Headers.Headers) => Effect.Effect<void>
		// A tools/list: runs or joins the first discovery, so a fresh process lists its stored connections' tools.
		readonly first: (headers: Headers.Headers) => Effect.Effect<void>
		// Resolve a known name without requiring the caller to list tools first.
		readonly resolve: (
			name: string,
			headers: Headers.Headers,
			authorize: Effect.Effect<boolean>
		) => Effect.Effect<void, AuthError>
		// A tools/list answered from the registry: a stale registry is refreshed in the background, and a changed tool set notifies clients.
		readonly refresh: (headers: Headers.Headers) => Effect.Effect<void>
		// A removed connection's tools leave the registry, and clients hear that their list changed.
		readonly removed: Effect.Effect<void, AuthError>
	}
>()('@deslop/gateway/services/gateway/service/Gateway') {
	static readonly layer = Layer.effect(
		Gateway,
		Effect.gen(function* () {
			const registry = yield* McpServer.McpServer
			const auth = yield* Auth
			const url = yield* gatewayUrl
			const connections = yield* Connections
			const upstreams = yield* Upstreams
			const digest = yield* Digest.Digest
			const namespaced = Effect.fnUntraced(function* (fullName: string) {
				if (
					fullName.length <= 64 &&
					Option.isSome(String.match(/^[a-zA-Z0-9_-]+$/u)(fullName)) &&
					!String.includes('__encoded_')(fullName)
				) {
					return fullName
				}
				return `${String.slice(0, 41)(String.replaceAll(/[^a-zA-Z0-9_-]/gu, '_')(fullName))}__encoded_${String.slice(0, 12)(Base64Url.encode(yield* digest.digest(Digest.sha256, new TextEncoder().encode(fullName))))}`
			})
			const visible = yield* Ref.make(HashSet.empty<string>())
			const installed = yield* Ref.make<
				HashMap.HashMap<string, {fingerprint: string; generation: ConnectionGeneration; id: ConnectionState['id']}>
			>(HashMap.empty())
			const refreshes = yield* Semaphore.make(1)
			const scope = yield* Effect.scope
			// McpServer has no removal: a removed tool stays registered, and the usability check hides it from lists and calls.
			const remove = Effect.fnUntraced(function* (name: string) {
				yield* Ref.update(installed, HashMap.remove(name))
				yield* Ref.update(visible, HashSet.remove(name))
			})
			const prune = Effect.gen(function* () {
				const names = prunedTools(yield* connections.definitions, yield* Ref.get(installed))
				yield* Effect.forEach(names, remove, {concurrency: 1, discard: true})
				if (Array.isArrayNonEmpty(names)) yield* registry.notifications['notifications/tools/list_changed']({})
			})
			const updateVisible = Effect.fnUntraced(function* (server: ConnectionState, names: HashSet.HashSet<string>) {
				const changed = yield* Ref.modify(visible, current => {
					const next = pipe(
						current,
						HashSet.filter(name => !String.startsWith(`${server.id}__`)(name)),
						HashSet.union(names)
					)
					return [!Equal.equals(current, next), next]
				})
				for (const entry of yield* Ref.get(installed)) {
					if (entry[1].id === server.id && !HashSet.has(names, entry[0])) yield* remove(entry[0])
				}
				if (changed) yield* registry.notifications['notifications/tools/list_changed']({})
			})
			const services = yield* Layer.build(
				// judge-ignore no-silent-fallback -- Visibility denies access when authorization cannot be established; it never substitutes a tool result.
				McpServer.visibility(options =>
					Effect.gen(function* () {
						if (!HashSet.has(yield* Ref.get(visible), options.target)) return false
						return yield* pipe(
							yield* Ref.get(installed),
							HashMap.get(options.target),
							Option.match({
								onNone: () => Effect.succeed(false),
								onSome: Effect.fnUntraced(function* (entry) {
									const current = yield* Boolean.match(options.method === 'tools/list', {
										onFalse: () =>
											pipe(
												connections.get(entry.id),
												Effect.tapError(error =>
													Effect.logWarning('Tool visibility could not read its connection', error)
												),
												Effect.option
											),
										onTrue: Effect.fnUntraced(function* () {
											return Array.findFirst(yield* yield* listingConnections, found => found.id === entry.id)
										})
									})
									return Option.exists(
										current,
										found => found.generation === entry.generation && found.status === 'Connected'
									)
								})
							})
						)
					})
				).layer
			)
			const resolveUpstream = Effect.fnUntraced(function* (server: ServerReference, headers: Headers.Headers) {
				const current = yield* connections.get(server.id)
				if (current.generation !== server.generation || current.status !== 'Connected') {
					return yield* AuthError.make({message: `${server.name} is not connected; connect it on ${url}`})
				}
				if (current.mode === 'public') return {headers: Headers.empty, token: Option.none<string>(), url: current.url}
				if (current.mode === 'deslop') {
					return {
						headers: Headers.fromInput({[ON_BEHALF_HEADER]: (yield* auth.user(headers)).id}),
						token: Option.none<string>(),
						url: current.url
					}
				}
				const token = yield* connections.token(server.id, server.generation, Option.none())
				return {
					headers: Headers.fromInput({authorization: `Bearer ${token}`}),
					token: Option.some(token),
					url: current.url
				}
			})
			const withClient = Effect.fnUntraced(function* <A, E>(
				server: ServerReference,
				headers: Headers.Headers,
				run: Parameters<typeof upstreams.use<A, E>>[1]
			) {
				// The token the rejected attempt sent, so a refresh replaces exactly that one.
				const sent = yield* Ref.make(Option.none<string>())
				const authorize = Effect.tap(resolveUpstream(server, headers), current => Ref.set(sent, current.token))
				return yield* pipe(
					upstreams.use(authorize, run),
					Effect.catchIf(
						error => server.mode === 'oauth' && upstreamStatus(error) === 401,
						() =>
							pipe(
								Ref.get(sent),
								Effect.flatMap(token => connections.token(server.id, server.generation, token)),
								Effect.andThen(upstreams.use(authorize, run))
							)
					),
					Effect.mapError(connectionFailure(server.name))
				)
			})
			const call = Effect.fn('Gateway.call')(
				function* (server: ServerReference, tool: McpSchema.Tool, input: unknown) {
					yield* Effect.annotateCurrentSpan({'mcp.server': server.id, 'mcp.tool': tool.name})
					const request = yield* Effect.flatMap(
						Effect.serviceOption(HttpServerRequest.HttpServerRequest),
						Effect.fromOption
					)
					yield* connections.called(server.id)
					const args = yield* Schema.decodeUnknownEffect(ToolArguments)(input ?? {})
					return yield* withClient(server, request.headers, client =>
						Effect.tap(client.callTool(tool, args), result =>
							Effect.annotateCurrentSpan({'mcp.is_error': result.isError === true})
						)
					)
				},
				// The agent reads the failure as a tool result; the trace keeps its cause.
				(effect, server) =>
					pipe(
						effect,
						Effect.tapCause(cause => Effect.logWarning(`${server.name} call failed`, cause)),
						Effect.catch(cause =>
							Effect.succeed(
								McpSchema.CallToolResult.make({
									content: [
										{
											text: `${connectionFailure(server.name)(cause).message}. The action may already have committed; inspect its current state before retrying. Use list_mcp_connections for connection failures.`,
											type: 'text'
										}
									],
									isError: true
								})
							)
						)
					)
			)
			const discover = Effect.fnUntraced(function* (server: ConnectionState, headers: Headers.Headers) {
				if (server.status !== 'Connected') {
					return yield* updateVisible(server, HashSet.empty())
				}
				const found = yield* Effect.timeout(
					withClient(server, headers, client =>
						pipe(
							client.listTools(),
							Effect.flatMap(result => Effect.map(Schema.decodeUnknownEffect(RemoteTools)(result), tools => ({tools}))),
							Effect.map(result => ({
								icons: serverIcons(client.serverInfo),
								instructions: Option.fromUndefinedOr(client.instructions),
								...result
							}))
						)
					),
					Duration.seconds(20)
				)
				const latest = yield* connections.get(server.id)
				if (latest.generation !== server.generation || latest.status === 'Not connected') {
					return yield* AuthError.make({
						error: 'temporarily_unavailable',
						message: `${server.name} changed while its tools were read`
					})
				}
				const reference = Struct.pick(server, ['id', 'generation', 'name', 'mode'])
				const names = yield* Effect.forEach(
					found.tools,
					Effect.fnUntraced(function* (tool) {
						const name = yield* namespaced(`${server.id}__${tool.name}`)
						const fingerprint = yield* Schema.encodeEffect(Schema.fromJsonString(RemoteTool))(tool)
						if (
							!pipe(
								yield* Ref.get(installed),
								HashMap.get(name),
								Option.exists(entry => entry.fingerprint === `${server.generation}:${fingerprint}`)
							)
						) {
							yield* Ref.update(
								installed,
								HashMap.set(name, {
									fingerprint: `${server.generation}:${fingerprint}`,
									generation: server.generation,
									id: server.id
								})
							)
							yield* Ref.update(visible, HashSet.add(name))
							yield* registry.addTool({
								annotations: Context.empty(),
								handle: (input: unknown) => call(reference, compact(tool), input),
								services,
								tool: McpSchema.Tool.make({...compact(tool), name})
							})
						}
						return name
					}),
					{concurrency: 1}
				)
				yield* updateVisible(server, HashSet.fromIterable(names))
				yield* connections.report(
					server.id,
					server.generation,
					Discovery.cases.Discovered.make({
						icons: found.icons,
						instructions: found.instructions,
						tools: Array.map(found.tools, tool => tool.name)
					})
				)
			})
			const lastRead = yield* Ref.make(Option.none<DateTime.Utc>())
			// Share only in-flight discovery; descriptors remain owned by the MCP registry.
			const reading = yield* RcMap.make({
				lookup: Effect.fnUntraced(function* (id: ServerId) {
					const server = yield* connections.get(id)
					return yield* pipe(
						discover(server, yield* discoveryHeaders),
						Effect.tapCause(cause => Effect.logWarning(`${server.name} discovery failed`, cause)),
						Effect.tapError(error =>
							connections.report(server.id, server.generation, Discovery.cases.Failed.make({error: describe(error)}))
						),
						Effect.mapError(connectionFailure(server.name))
					)
				})
			})
			function readServer(id: ServerId, headers: Headers.Headers) {
				return pipe(RcMap.get(reading, id), Effect.provideService(discoveryHeaders, headers), Effect.scoped)
			}
			const discovery = yield* FiberHandle.make<void, never>()
			const read = Effect.fnUntraced(function* (headers: Headers.Headers) {
				yield* Effect.ensuring(
					pipe(
						prune,
						Effect.andThen(connections.definitions),
						Effect.flatMap(definitions =>
							Effect.forEach(
								definitions,
								server =>
									Effect.ignore(readServer(server.id, headers), {log: 'Warn', message: 'Cannot discover MCP tools'}),
								{concurrency: 6, discard: true}
							)
						),
						Effect.andThen(prune),
						// The servers' storage failing leaves the registry as it was until the next read.
						Effect.catch(cause => Effect.logWarning('The MCP servers could not be read', cause))
					),
					Effect.flatMap(DateTime.now, now => Ref.set(lastRead, Option.some(now)))
				)
			})
			// The caller waits up to 2 seconds; a slow read finishes in the gateway's scope, and its defect never fails the caller.
			const settle = Effect.fnUntraced(function* (fiber: Fiber.Fiber<void>) {
				yield* pipe(
					Fiber.join(fiber),
					Effect.timeoutOption(Duration.seconds(2)),
					Effect.catchCause(cause => Effect.logWarning('Reading the servers’ tools failed', cause))
				)
			})
			const first = Effect.fn('Gateway.first')(function* (headers: Headers.Headers) {
				if (Option.isSome(yield* Ref.get(lastRead))) return
				yield* settle(
					yield* Option.match(yield* FiberHandle.get(discovery), {
						onNone: () => FiberHandle.run(discovery, refreshes.withPermits(1)(read(headers))),
						onSome: Effect.succeed
					})
				)
			})
			const refresh = Effect.fn('Gateway.refresh')(function* (headers: Headers.Headers) {
				const now = yield* DateTime.now
				// An agent lists tools far more often than upstreams change, so a registry younger than 30 seconds answers alone.
				if (
					!Option.exists(yield* Ref.get(lastRead), at =>
						pipe(at, DateTime.distance(now), Duration.isGreaterThanOrEqualTo(Duration.seconds(30)))
					)
				) {
					return
				}
				yield* FiberHandle.run(
					discovery,
					Effect.withSpan(refreshes.withPermits(1)(read(headers)), 'Gateway.discover'),
					{onlyIfMissing: true}
				)
			})
			return Gateway.of({
				connected: Effect.fn('Gateway.connected')(function* (headers) {
					// A connection changed: queue a forced snapshot behind any older read.
					yield* settle(yield* Effect.forkIn(refreshes.withPermits(1)(read(headers)), scope))
				}),
				first,
				refresh,
				removed: Effect.withSpan(prune, 'Gateway.removed'),
				resolve: Effect.fn('Gateway.resolve')(function* (name, headers, authorize) {
					const found = Array.findFirst(yield* connections.definitions, entry =>
						String.startsWith(`${entry.id}__`)(name)
					)
					return yield* Option.match(found, {
						onNone: () => Effect.void,
						onSome: Effect.fnUntraced(function* (current) {
							if (
								current.status === 'Connected' &&
								HashSet.has(yield* Ref.get(visible), name) &&
								pipe(
									yield* Ref.get(installed),
									HashMap.get(name),
									Option.exists(entry => entry.generation === current.generation)
								)
							) {
								return
							}
							// Registered calls use MCP's own auth check; discovery needs a verified bearer before starting work.
							if (!(yield* authorize)) return
							// A saved descriptor is not evidence that the server is still authorized.
							if (current.status !== 'Connected') {
								return yield* AuthError.make({message: `${current.name} is not connected; connect it on ${url}`})
							}
							yield* readServer(current.id, headers)
						})
					})
				})
			})
		})
	)
}

// Discovery runs before MCP's registry lookup, after bearer verification; calls await only their server.
export const GatewayDiscovery = HttpRouter.middleware()(
	Effect.gen(function* () {
		const gateway = yield* Gateway
		const auth = yield* Auth
		const connections = yield* Connections
		return app =>
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				if (request.method !== 'POST' || request.url !== MCP_PATH || request.headers['origin'] !== undefined) {
					return yield* app
				}
				const body = yield* Effect.result(request.json)
				if (Result.isFailure(body) || !Schema.is(ToolRequest)(body.success)) return yield* app
				if (body.success.method === 'tools/call') {
					const resolved = yield* Effect.result(
						gateway.resolve(body.success.params.name, request.headers, Effect.isSuccess(auth.user(request.headers)))
					)
					if (Result.isFailure(resolved)) {
						return HttpServerResponse.jsonUnsafe({
							id: body.success.id,
							jsonrpc: '2.0',
							result: {content: [{text: resolved.failure.message, type: 'text'}], isError: true}
						})
					}
					return yield* app
				}
				const verified = yield* Effect.result(auth.user(request.headers))
				if (Result.isFailure(verified)) {
					return HttpServerResponse.jsonUnsafe({error: verified.failure.message}, failureOptions(verified.failure, 401))
				}
				yield* gateway.first(request.headers)
				// A storage outage remains a failed listing rather than an apparently empty registry.
				const snapshot = yield* Effect.result(connections.definitions)
				if (Result.isFailure(snapshot)) {
					return HttpServerResponse.jsonUnsafe({error: snapshot.failure.message}, {status: 503})
				}
				const response = yield* Effect.provideService(app, listingConnections, Effect.succeed(snapshot.success))
				yield* gateway.refresh(request.headers)
				return response
			})
	})
)
