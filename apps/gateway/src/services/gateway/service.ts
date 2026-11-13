import {
	Array,
	DateTime,
	Duration,
	Context,
	Effect,
	Equal,
	Fiber,
	FiberHandle,
	HashSet,
	Layer,
	MutableList,
	Option,
	Ref,
	Record,
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
import {HttpRouter, HttpServerRequest} from 'effect/http'
import type {Headers} from 'effect/http'

import {Auth} from '@deslop/runtime/server/auth'
import {AuthError, bearerOf, isJwt} from '@deslop/runtime/shared/auth'
import {MCP_PATH} from '@deslop/runtime/shared/schema'

import {connectionFailure, serverIcons} from '#services/connections/lib/utils.ts'
import type {ConnectionGeneration, ConnectionState} from '#services/connections/schema.ts'
import {Connections, gatewayUrl} from '#services/connections/service.ts'
import {compact, prunedTools} from '#services/gateway/lib/utils.ts'
import {RemoteTool, RemoteTools, ToolArguments, ToolRequest} from '#services/gateway/schema.ts'
import {Upstreams, upstreamStatus} from '#services/upstreams/service.ts'

type Server = Pick<ConnectionState, 'id' | 'generation' | 'name' | 'mode'>

export class Gateway extends Context.Service<
	Gateway,
	{
		// A connection that was added or re-authorized: its tools are read now, even while another read runs.
		readonly connected: (headers: Headers.Headers) => Effect.Effect<void>
		// A tools/list: runs or joins the first discovery, so a fresh process lists its stored connections' tools.
		readonly first: (headers: Headers.Headers) => Effect.Effect<void>
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
				Record<string, {fingerprint: string; generation: ConnectionGeneration; id: ConnectionState['id']}>
			>({})
			const usable = Effect.fnUntraced(function* (id: ConnectionState['id'], generation: ConnectionGeneration) {
				return Option.exists(
					yield* Effect.option(connections.get(id)),
					found => found.generation === generation && found.status === 'Connected'
				)
			})
			const refreshes = yield* Semaphore.make(1)
			const scope = yield* Effect.scope
			// McpServer has no removal: a removed tool stays registered, and the usability check hides it from lists and calls.
			const remove = Effect.fnUntraced(function* (name: string) {
				yield* Ref.update(installed, Record.remove(name))
				yield* Ref.update(visible, HashSet.remove(name))
				yield* registry.notifications['notifications/tools/list_changed']({})
			})
			const prune = Effect.gen(function* () {
				yield* Effect.forEach(prunedTools(yield* connections.definitions, yield* Ref.get(installed)), remove, {
					concurrency: 1,
					discard: true
				})
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
				if (changed) yield* registry.notifications['notifications/tools/list_changed']({})
				for (const entry of Record.toEntries(yield* Ref.get(installed))) {
					if (entry[1].id === server.id && !HashSet.has(names, entry[0])) yield* remove(entry[0])
				}
			})
			const services = yield* Layer.build(
				McpServer.visibility(options =>
					Effect.gen(function* () {
						if (!HashSet.has(yield* Ref.get(visible), options.target)) return false
						return yield* pipe(
							yield* Ref.get(installed),
							Record.get(options.target),
							Option.match({onNone: () => Effect.succeed(false), onSome: entry => usable(entry.id, entry.generation)})
						)
					})
				).layer
			)
			const resolveUpstream = Effect.fnUntraced(function* (server: Server, headers: Headers.Headers) {
				const current = yield* connections.get(server.id)
				if (current.generation !== server.generation || current.status !== 'Connected') {
					return yield* AuthError.make({message: `${server.name} is not connected; connect it on ${url}`})
				}
				if (current.mode === 'public') return {token: Option.none<string>(), url: current.url}
				if (current.mode === 'deslop') {
					// Every request that reaches here already verified its bearer, so an access token is forwarded without a second check; a session id still becomes its token.
					return {
						token: Option.some(
							yield* pipe(
								bearerOf(headers),
								Option.filter(isJwt),
								Option.match({onNone: () => auth.token(headers), onSome: Effect.succeed})
							)
						),
						url: current.url
					}
				}
				return {
					token: Option.some(yield* connections.token(server.id, server.generation, Option.none())),
					url: current.url
				}
			})
			const withClient = Effect.fnUntraced(function* <A, E>(
				server: Server,
				headers: Headers.Headers,
				run: Parameters<typeof upstreams.use<A, E>>[2]
			) {
				const upstream = yield* resolveUpstream(server, headers)
				return yield* pipe(
					upstreams.use(upstream.url, upstream.token, run),
					Effect.catchIf(
						error => server.mode === 'oauth' && upstreamStatus(error) === 401,
						() =>
							Effect.flatMap(connections.token(server.id, server.generation, upstream.token), token =>
								upstreams.use(upstream.url, Option.some(token), run)
							)
					),
					Effect.mapError(connectionFailure(server.name))
				)
			})
			const call = Effect.fn('Gateway.call')(
				function* (server: Server, tool: McpSchema.Tool, input: unknown) {
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
							Effect.flatMap(result => Effect.map(Schema.decodeEffect(RemoteTools)(result), tools => ({tools}))),
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
				const names = MutableList.make<string>()
				for (const tool of found.tools) {
					const name = yield* namespaced(`${server.id}__${tool.name}`)
					const fingerprint = yield* Schema.encodeEffect(Schema.fromJsonString(RemoteTool))(tool)
					if (
						!pipe(
							yield* Ref.get(installed),
							Record.get(name),
							Option.exists(entry => entry.fingerprint === `${server.generation}:${fingerprint}`)
						)
					) {
						yield* registry.addTool({
							annotations: Context.empty(),
							handle: (input: unknown) => call(reference, compact(tool), input),
							services,
							tool: McpSchema.Tool.make({...compact(tool), name})
						})
						yield* Ref.update(installed, current => ({
							...current,
							[name]: {fingerprint: `${server.generation}:${fingerprint}`, generation: server.generation, id: server.id}
						}))
					}
					MutableList.append(names, name)
				}
				yield* updateVisible(server, HashSet.fromIterable(MutableList.toArray(names)))
				yield* connections.report(server.id, server.generation, {
					_tag: 'Discovered',
					icons: found.icons,
					instructions: found.instructions,
					tools: Array.map(found.tools, tool => tool.name)
				})
			})
			const lastRead = yield* Ref.make(Option.none<DateTime.Utc>())
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
									pipe(
										discover(server, headers),
										Effect.tapCause(cause => Effect.logWarning(`${server.name} discovery failed`, cause)),
										Effect.catch(cause =>
											connections.report(server.id, server.generation, {
												_tag: 'Failed',
												error: connectionFailure(server.name)(cause).message
											})
										)
									),
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
				const last = yield* Ref.get(lastRead)
				if (Option.isNone(last)) return
				// An agent lists tools far more often than upstreams change, so a registry younger than 30 seconds answers alone.
				if (pipe(last, Option.getOrThrow, DateTime.distance(now), Duration.isLessThan(Duration.seconds(30)))) return
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
				removed: Effect.withSpan(prune, 'Gateway.removed')
			})
		})
	)
}

// A tools/list verifies the bearer once, runs or joins the first discovery, then answers from the registry; a stale registry refreshes behind the answer.
export const GatewayDiscovery = HttpRouter.middleware()(
	Effect.gen(function* () {
		const gateway = yield* Gateway
		const auth = yield* Auth
		return app =>
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				if (request.method !== 'POST' || request.url !== MCP_PATH || request.headers['origin'] !== undefined) {
					return yield* app
				}
				const body = yield* Effect.result(request.json)
				if (Result.isFailure(body) || !Schema.is(ToolRequest)(body.success)) return yield* app
				const verified = yield* Effect.result(auth.user(request.headers))
				if (Result.isSuccess(verified)) yield* gateway.first(request.headers)
				const response = yield* app
				// A refusal or an Auth outage starts no work with the bearer it could not verify.
				if (Result.isSuccess(verified)) yield* gateway.refresh(request.headers)
				return response
			})
	})
)
