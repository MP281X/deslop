import {
	Array,
	Clock,
	Context,
	Deferred,
	Effect,
	Equal,
	Fiber,
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

import type {Client} from '@modelcontextprotocol/client'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
import {McpSchema, McpServer} from 'effect/ai'
import {Digest} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {FetchHttpClient, HttpRouter, HttpServerRequest} from 'effect/http'
import type {Headers} from 'effect/http'

import {AuthError} from '@deslop/runtime/auth/schema'
import {Auth} from '@deslop/runtime/auth/service'
import {bearerOf, isJwt} from '@deslop/runtime/auth/utils'
import {MCP_PATH} from '@deslop/runtime/schema'

import {
	connectionStatus,
	describe,
	endSession,
	gatewayUrl,
	mcpClient,
	serverIcons
} from '#services/connections/lib/utils.ts'
import type {Connection} from '#services/connections/schema.ts'
import {Connections} from '#services/connections/service.ts'
import {compact, prunedTools} from '#services/gateway/lib/utils.ts'
import {RemoteTools, ToolArguments, ToolRequest} from '#services/gateway/schema.ts'

type Server = Pick<Connection, 'id' | 'generation' | 'name' | 'mode'>

// The failure keeps its cause for traces and names it for the MCP page and the calling agent.
function rejected(server: Pick<Connection, 'name'>) {
	return (cause: unknown) => {
		if (Schema.is(AuthError)(cause)) return cause
		return AuthError.make({cause, message: `${server.name}: ${describe(cause)}`})
	}
}

export class Gateway extends Context.Service<
	Gateway,
	{
		// A connection that was added or re-authorized: its tools are read now, even while another read runs.
		readonly connected: (headers: Headers.Headers) => Effect.Effect<void>
		// A tools/list: a first discovery under way is awaited so a just-added server's tools are listed; otherwise the registry answers alone.
		readonly joinFirst: Effect.Effect<void>
		// A tools/list answered from the registry: a stale registry is refreshed in the background, and a changed tool set notifies clients.
		readonly refresh: (headers: Headers.Headers) => Effect.Effect<void>
		// A removed connection's tools leave the registry, and clients hear that their list changed.
		readonly removed: Effect.Effect<void>
	}
>()('@deslop/gateway/services/gateway/service/Gateway') {
	static readonly layer = Layer.effect(Gateway)(
		Effect.gen(function* () {
			const registry = yield* McpServer.McpServer
			const auth = yield* Auth
			const url = yield* gatewayUrl
			const connections = yield* Connections
			const fetch = yield* FetchHttpClient.Fetch
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
			const installed = yield* Ref.make<Record<string, {fingerprint: string; generation: string; id: string}>>({})
			const usable = Effect.fnUntraced(function* (id: string, generation: string) {
				const now = yield* Clock.currentTimeMillis
				return Option.exists(
					yield* Effect.option(connections.get(id)),
					found => found.generation === generation && connectionStatus(found, now) === 'Connected'
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
			const updateVisible = Effect.fnUntraced(function* (server: Connection, names: HashSet.HashSet<string>) {
				const changed = yield* Ref.modify(visible, current => {
					const next = HashSet.union(
						HashSet.filter(current, name => !String.startsWith(`${server.id}__`)(name)),
						names
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
						const entry = (yield* Ref.get(installed))[options.target]
						if (entry === undefined) return false
						return yield* usable(entry.id, entry.generation)
					})
				).layer
			)
			const upstreamFor = Effect.fnUntraced(function* (server: Server, headers: Headers.Headers) {
				const current = yield* connections.get(server.id)
				if (
					current.generation !== server.generation ||
					connectionStatus(current, yield* Clock.currentTimeMillis) !== 'Connected'
				) {
					return yield* AuthError.make({message: `${server.name} is not connected; connect it on ${url}`})
				}
				if (current.mode === 'public') return {token: undefined, url: current.url}
				if (current.mode === 'deslop') {
					// Every request that reaches here already verified its bearer, so an access token is forwarded without a second check; a session id still becomes its token.
					return {
						token: Option.getOrUndefined(Option.filter(bearerOf(headers), isJwt)) ?? (yield* auth.token(headers)),
						url: current.url
					}
				}
				return {token: yield* connections.token(server.id, server.generation), url: current.url}
			})
			function withClient<A>(
				server: Server,
				headers: Headers.Headers,
				run: (client: Client) => Effect.Effect<A, AuthError>
			) {
				return pipe(
					Effect.gen(function* () {
						const upstream = yield* upstreamFor(server, headers)
						const context = yield* Effect.context()
						const transport = new StreamableHTTPClientTransport(new URL(upstream.url), {
							authProvider: {
								onUnauthorized: () =>
									// oxlint-disable-next-line no-restricted-properties -- The MCP SDK's AuthProvider contract requires a Promise<void>.
									Effect.runPromise(
										pipe(
											Effect.gen(function* () {
												if (server.mode === 'oauth') {
													upstream.token = yield* connections.token(server.id, server.generation, upstream.token)
												}
											}),
											Effect.provideContext(context)
										)
									),
								token: () =>
									// oxlint-disable-next-line no-restricted-properties -- The MCP SDK's AuthProvider.token contract requires a Promise<string>.
									Effect.runPromise(Effect.succeed(upstream.token))
							},
							fetch,
							requestInit: {redirect: 'error'}
						})
						const client = yield* Effect.acquireRelease(Effect.sync(mcpClient), acquired =>
							endSession(transport, acquired, rejected(server), 'upstream')
						)
						yield* Effect.tryPromise({catch: rejected(server), try: signal => client.connect(transport, {signal})})
						return yield* run(client)
					}),
					Effect.mapError(rejected(server)),
					Effect.scoped
				)
			}
			const call = Effect.fn('Gateway.call')(
				function* (server: Server, tool: string, input: unknown) {
					const request = yield* Effect.flatMap(
						Effect.serviceOption(HttpServerRequest.HttpServerRequest),
						Effect.fromOption
					)
					yield* connections.called(server.id)
					const args = yield* Schema.decodeUnknownEffect(ToolArguments)(input ?? {})
					return yield* withClient(server, request.headers, client =>
						pipe(
							Effect.tryPromise({
								catch: rejected(server),
								try: signal => client.callTool({arguments: args, name: tool}, {signal})
							}),
							Effect.flatMap(Schema.decodeUnknownEffect(McpSchema.CallToolResult)),
							Effect.mapError(rejected(server))
						)
					)
				},
				// The agent reads the failure as a tool result; the trace keeps its cause.
				(effect, server) =>
					Effect.catch(
						Effect.tapCause(effect, cause => Effect.logWarning(`${server.name} call failed`, cause)),
						cause =>
							Effect.succeed(
								McpSchema.CallToolResult.make({
									content: [
										{
											text: `${rejected(server)(cause).message}. list_mcp_connections shows its state; reconnect it at ${url}.`,
											type: 'text'
										}
									],
									isError: true
								})
							)
					)
			)
			const discover = Effect.fnUntraced(function* (server: Connection, headers: Headers.Headers) {
				if (connectionStatus(server, yield* Clock.currentTimeMillis) !== 'Connected') {
					return yield* updateVisible(server, HashSet.empty())
				}
				const found = yield* pipe(
					withClient(server, headers, client =>
						pipe(
							Effect.tryPromise({catch: rejected(server), try: signal => client.listTools(undefined, {signal})}),
							Effect.flatMap(result =>
								Schema.decodeUnknownEffect(RemoteTools)(
									Array.filter(result.tools, tool => tool.execution?.taskSupport !== 'required')
								)
							),
							Effect.mapBoth({
								onFailure: rejected(server),
								onSuccess: tools => ({
									icons: serverIcons(client.getServerVersion()),
									instructions: client.getInstructions(),
									tools
								})
							})
						)
					),
					Effect.timeout('20 seconds')
				)
				const latest = yield* connections.get(server.id)
				if (latest.generation !== server.generation || latest.link._tag === 'Disconnected') {
					return yield* AuthError.make({message: `${server.name} changed while its tools were read`})
				}
				const reference = Struct.pick(server, ['id', 'generation', 'name', 'mode'])
				const names = MutableList.make<string>()
				for (const tool of found.tools) {
					const upstreamName = tool.name
					const name = yield* namespaced(`${server.id}__${tool.name}`)
					const fingerprint = yield* Schema.encodeEffect(Schema.fromJsonString(McpSchema.Tool))(tool)
					if ((yield* Ref.get(installed))[name]?.fingerprint !== `${server.generation}:${fingerprint}`) {
						yield* registry.addTool({
							annotations: Context.empty(),
							handle: Effect.fnUntraced(function* (input: unknown) {
								return yield* call(reference, upstreamName, input)
							}),
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
					...Option.match(Option.fromUndefinedOr(found.instructions), {
						onNone: () => ({}),
						onSome: instructions => ({instructions})
					}),
					tools: Array.map(found.tools, tool => tool.name)
				})
			})
			const lastRead = yield* Ref.make(Option.none<number>())
			const inFlight = yield* Ref.make(Option.none<Deferred.Deferred<void>>())
			const read = Effect.fnUntraced(function* (headers: Headers.Headers) {
				const done = yield* Deferred.make<void>()
				yield* Ref.set(inFlight, Option.some(done))
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
												error: rejected(server)(cause).message
											})
										)
									),
								{concurrency: 6, discard: true}
							)
						),
						Effect.andThen(prune)
					),
					Effect.gen(function* () {
						yield* Ref.set(lastRead, Option.some(yield* Clock.currentTimeMillis))
						yield* Ref.set(inFlight, Option.none())
						yield* Deferred.succeed(done, undefined)
					})
				)
			})
			// The caller waits up to 2 seconds; a slow read finishes in the gateway's scope, and its defect never fails the caller.
			const settle = Effect.fnUntraced(function* (work: Effect.Effect<unknown>) {
				yield* pipe(
					Fiber.join(yield* Effect.forkIn(work, scope)),
					Effect.timeoutOption('2 seconds'),
					Effect.catchCause(cause => Effect.logWarning('Reading the servers’ tools failed', cause))
				)
			})
			const joinFirst = Effect.gen(function* () {
				if (Option.isSome(yield* Ref.get(lastRead))) return
				const pending = Option.getOrUndefined(yield* Ref.get(inFlight))
				if (pending === undefined) return
				yield* pipe(Deferred.await(pending), Effect.timeoutOption('2 seconds'), Effect.asVoid)
			})
			const refresh = Effect.fnUntraced(function* (headers: Headers.Headers) {
				const now = yield* Clock.currentTimeMillis
				const last = yield* Ref.get(lastRead)
				// An agent lists tools far more often than upstreams change, so a registry younger than 30 seconds answers alone.
				if (Option.exists(last, readAt => now - readAt < 30_000)) return
				if (Option.isNone(last)) {
					// The first list waits for the first discovery, so a fresh registry answers with its tools.
					yield* settle(refreshes.withPermits(1)(read(headers)))
					return
				}
				yield* Effect.forkIn(
					Effect.withSpan(refreshes.withPermitsIfAvailable(1)(read(headers)), 'Gateway.refresh'),
					scope
				)
			})
			return Gateway.of({
				connected: headers => Effect.withSpan(settle(refreshes.withPermits(1)(read(headers))), 'Gateway.connected'),
				joinFirst,
				refresh,
				removed: Effect.withSpan(prune, 'Gateway.removed')
			})
		})
	)
}

// A tools/list is answered from the registry: it waits only for a first discovery already under way, then a stale refresh follows the answer.
export const GatewayDiscovery = HttpRouter.middleware()(
	Effect.gen(function* () {
		const gateway = yield* Gateway
		return app =>
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				if (request.method !== 'POST' || request.url !== MCP_PATH || request.headers['origin'] !== undefined) {
					return yield* app
				}
				const body = yield* Effect.result(request.json)
				if (Result.isFailure(body) || !Schema.is(ToolRequest)(body.success)) return yield* app
				yield* gateway.joinFirst
				const response = yield* app
				// A refusal or an Auth outage did not verify the bearer, so it starts no work with it.
				if (response.status !== 401 && response.status !== 503) yield* gateway.refresh(request.headers)
				return response
			})
	})
)
