import {
	Array,
	Clock,
	Context,
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

import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
import {McpSchema, McpServer} from 'effect/ai'
import {Digest} from 'effect/crypto'
import {Base64Url} from 'effect/encoding'
import {FetchHttpClient, HttpRouter, HttpServerRequest} from 'effect/http'

import {AuthError} from '@deslop/runtime/auth/schema'
import {Auth} from '@deslop/runtime/auth/service'

import {connectionStatus, describe, gatewayUrl, serverIcons} from '#services/connections/lib/utils.ts'
import type {Connection} from '#services/connections/schema.ts'
import {Connections} from '#services/connections/service.ts'
import {compact} from '#services/gateway/lib/utils.ts'
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
	{readonly refresh: (registry: typeof McpServer.McpServer.Service) => Effect.Effect<void>}
>()('@deslop/gateway/services/gateway/service/Gateway') {
	static readonly layer = Layer.effect(Gateway)(
		Effect.gen(function* () {
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
			const installed = yield* Ref.make<
				Record<string, {fingerprint: string; generation: string; id: string; tool: string}>
			>({})
			// A server's tool counts while the server is connected and the owner has not hidden it.
			const usable = Effect.fnUntraced(function* (id: string, generation: string, tool: string) {
				const now = yield* Clock.currentTimeMillis
				return Option.exists(
					yield* Effect.option(connections.get(id)),
					found =>
						found.generation === generation &&
						connectionStatus(found, now) === 'Connected' &&
						!Array.contains(found.hidden, tool)
				)
			})
			const refreshes = yield* Semaphore.make(1)
			const scope = yield* Effect.scope
			// McpServer has no removal: a removed tool stays registered, and the visibility check hides it from lists and calls.
			const remove = Effect.fnUntraced(function* (name: string, registry: typeof McpServer.McpServer.Service) {
				yield* Ref.update(installed, Record.remove(name))
				yield* Ref.update(visible, HashSet.remove(name))
				yield* registry.notifications['notifications/tools/list_changed']({})
			})
			const prune = Effect.fnUntraced(function* (registry: typeof McpServer.McpServer.Service) {
				const definitions = yield* connections.definitions
				for (const entry of Record.toEntries(yield* Ref.get(installed))) {
					if (
						!Array.some(
							definitions,
							server =>
								server.id === entry[1].id &&
								server.generation === entry[1].generation &&
								server.link._tag !== 'Disconnected' &&
								!Array.contains(server.hidden, entry[1].tool)
						)
					) {
						yield* remove(entry[0], registry)
					}
				}
			})
			const updateVisible = Effect.fnUntraced(function* (
				server: Connection,
				names: HashSet.HashSet<string>,
				registry: typeof McpServer.McpServer.Service
			) {
				const changed = yield* Ref.modify(visible, current => {
					const next = HashSet.union(
						HashSet.filter(current, name => !String.startsWith(`${server.id}__`)(name)),
						names
					)
					return [!Equal.equals(current, next), next]
				})
				if (changed) yield* registry.notifications['notifications/tools/list_changed']({})
				for (const entry of Record.toEntries(yield* Ref.get(installed))) {
					if (entry[1].id === server.id && !HashSet.has(names, entry[0])) yield* remove(entry[0], registry)
				}
			})
			const services = yield* Layer.build(
				McpServer.visibility(options =>
					Effect.gen(function* () {
						if (!HashSet.has(yield* Ref.get(visible), options.target)) return false
						const entry = (yield* Ref.get(installed))[options.target]
						if (entry === undefined) return false
						return yield* usable(entry.id, entry.generation, entry.tool)
					})
				).layer
			)
			const upstreamFor = Effect.fnUntraced(function* (server: Server) {
				const current = yield* connections.get(server.id)
				if (
					current.generation !== server.generation ||
					connectionStatus(current, yield* Clock.currentTimeMillis) !== 'Connected'
				) {
					return yield* AuthError.make({message: `${server.name} is not connected; connect it on ${url}`})
				}
				if (current.mode === 'public') return {token: undefined, url: current.url}
				return {token: yield* connections.token(server.id, server.generation), url: current.url}
			})
			function withClient<A>(server: Server, run: (client: Client) => Effect.Effect<A, AuthError>) {
				return pipe(
					Effect.gen(function* () {
						const upstream = yield* upstreamFor(server)
						const context = yield* Effect.context<never>()
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
						const client = yield* Effect.acquireRelease(
							Effect.sync(
								() => new Client({name: 'Deslop MCP gateway', version: '0.1.0'}, {versionNegotiation: {mode: 'auto'}})
							),
							acquired =>
								pipe(
									Effect.tryPromise(() => transport.terminateSession()),
									Effect.timeout('3 seconds'),
									Effect.ignore({log: 'Warn', message: 'Cannot terminate the upstream MCP session'}),
									Effect.andThen(Effect.tryPromise(() => acquired.close())),
									Effect.ignore({log: 'Warn', message: 'Cannot close the upstream MCP client'})
								)
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
					yield* auth.access(request.headers, `${url}/mcp`)
					yield* connections.called(server.id)
					const args = yield* Schema.decodeUnknownEffect(ToolArguments)(input ?? {})
					return yield* withClient(server, client =>
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
			const discover = Effect.fnUntraced(function* (server: Connection, registry: typeof McpServer.McpServer.Service) {
				if (connectionStatus(server, yield* Clock.currentTimeMillis) !== 'Connected') {
					return yield* updateVisible(server, HashSet.empty(), registry)
				}
				const found = yield* pipe(
					withClient(server, client =>
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
				for (const tool of Array.filter(found.tools, candidate => !Array.contains(latest.hidden, candidate.name))) {
					const upstreamName = tool.name
					const name = yield* namespaced(`${server.id}__${tool.name}`)
					const fingerprint = yield* Schema.encodeEffect(Schema.fromJsonString(McpSchema.Tool))(tool)
					if (Option.isNone(String.match(/^[a-zA-Z0-9_-]{1,64}$/u)(name))) {
						return yield* AuthError.make({
							message: `${server.name} has a tool name that cannot be namespaced: ${tool.name}`
						})
					}
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
							[name]: {
								fingerprint: `${server.generation}:${fingerprint}`,
								generation: server.generation,
								id: server.id,
								tool: upstreamName
							}
						}))
					}
					MutableList.append(names, name)
				}
				yield* updateVisible(server, HashSet.fromIterable(MutableList.toArray(names)), registry)
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
			return Gateway.of({
				refresh: Effect.fn('Gateway.refresh')(function* (registry: typeof McpServer.McpServer.Service) {
					const worker = yield* Effect.forkIn(
						refreshes.withPermitsIfAvailable(1)(
							pipe(
								prune(registry),
								Effect.andThen(connections.definitions),
								Effect.flatMap(definitions =>
									Effect.forEach(
										definitions,
										server =>
											pipe(
												discover(server, registry),
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
								Effect.andThen(prune(registry))
							)
						),
						scope
					)
					yield* pipe(Fiber.join(worker), Effect.timeoutOption('2 seconds'))
				})
			})
		})
	)
}

// This memoized registry is also provided to layerMcp. Slow refreshes outlive the request, not the server.
export const GatewayDiscovery = HttpRouter.middleware()(
	Effect.gen(function* () {
		const gateway = yield* Gateway
		const auth = yield* Auth
		const url = yield* gatewayUrl
		const registry = yield* McpServer.McpServer
		return app =>
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				// A newly authorized server shows its tools and icon without waiting for an agent's tools/list.
				if (request.method === 'GET' && String.startsWith('/oauth/callback')(request.url)) {
					const response = yield* app
					yield* Effect.forkDetach(gateway.refresh(registry))
					return response
				}
				if (
					request.method === 'POST' &&
					request.url === '/mcp' &&
					request.headers['origin'] === undefined &&
					Result.isSuccess(yield* Effect.result(auth.access(request.headers, `${url}/mcp`)))
				) {
					const body = yield* Effect.result(request.json)
					if (Result.isSuccess(body) && Schema.is(ToolRequest)(body.success)) {
						yield* gateway.refresh(registry)
					}
				}
				return yield* app
			})
	})
)
