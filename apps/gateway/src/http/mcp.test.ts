import {NodeCrypto, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Config,
	ConfigProvider,
	Context,
	Effect,
	FileSystem,
	Layer,
	Option,
	Redacted,
	Schema,
	Struct,
	pipe
} from 'effect'

import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
import {McpClient, McpProtocol, McpSchema, McpServer} from 'effect/ai'
import {FetchHttpClient, Headers, HttpRouter} from 'effect/http'

import {Auth} from '@deslop/runtime/server/auth'
import {layerKeyValueStore} from '@deslop/runtime/server/store'
import {DEVELOPER} from '@deslop/runtime/shared/auth'

import {AiProxy, layerAiProxy} from '#services/ai/service.ts'
import {Connections} from '#services/connections/service.ts'
import {Gateway} from '#services/gateway/service.ts'
import {GatewayMcp} from '#tools/handlers.ts'

const OUTPUT = {properties: {values: {items: {type: 'number'}, type: 'array'}}, required: ['values'], type: 'object'}
const PACKET = Schema.decodeSync(McpSchema.CallToolResult)({
	_meta: {fixture: 'preserved'},
	content: [
		{text: 'An explanation distinct from the structured data.', type: 'text'},
		{
			data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII=',
			mimeType: 'image/png',
			type: 'image'
		},
		{resource: {mimeType: 'text/plain', text: 'Source material.', uri: 'memo://fixture/source'}, type: 'resource'}
	],
	isError: false,
	structuredContent: {values: [1, 2, 3]}
})
const DOCUMENT = McpSchema.CallToolResult.make({
	content: [{text: '{"document":"text, not inferred data"}', type: 'text'}],
	isError: false
})
const FAILURE = McpSchema.CallToolResult.make({
	content: [{text: 'The requested fixture action did not commit.', type: 'text'}],
	isError: true,
	structuredContent: {reason: 'refused'}
})

it.layer(Layer.mergeAll(NodeCrypto.layer, NodeServices.layer))('Gateway real MCP relay', test => {
	test.effect(
		'preserves upstream schemas, structured data, distinct text, images, resources and tool errors',
		Effect.fnUntraced(function* () {
			const capture = Option.getOrUndefined(yield* Config.option(Config.String('MCP_PROOF_DIRECTORY')))
			const fs = yield* FileSystem.FileSystem
			const directory = yield* fs.makeTempDirectoryScoped()
			const memoMap = yield* Layer.makeMemoMap
			const scope = yield* Effect.scope
			function captureCall(name: string, descriptor: unknown, result: unknown) {
				if (capture === undefined) return Effect.void
				return Effect.gen(function* () {
					yield* fs.writeFileString(
						`${capture}/${name}.list.json`,
						yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(descriptor)
					)
					yield* fs.writeFileString(
						`${capture}/${name}.call.json`,
						yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(result)
					)
				})
			}
			const upstream = yield* Effect.acquireRelease(
				Effect.sync(() =>
					HttpRouter.toWebHandler(
						McpServer.layerHttp({
							name: 'Relay fixture',
							path: '/mcp',
							protocols: [McpProtocol.v2026_07_28, McpProtocol.v2025_06_18],
							registrations: Layer.effectDiscard(
								Effect.gen(function* () {
									const registry = yield* McpServer.McpServer
									for (const entry of [
										{name: 'packet', result: PACKET},
										{name: 'document', result: DOCUMENT},
										{name: 'failure', result: FAILURE}
									]) {
										yield* registry.addTool({
											annotations: Context.empty(),
											handle: () => Effect.succeed(entry.result),
											tool: McpSchema.Tool.make({
												inputSchema: {type: 'object'},
												name: entry.name,
												...Option.match(
													Option.liftPredicate(OUTPUT, () => entry.name !== 'document'),
													{onNone: () => ({}), onSome: outputSchema => ({outputSchema})}
												)
											})
										})
									}
								})
							),
							version: '1'
						})
					)
				),
				web => Effect.promise(() => web.dispose())
			)
			const auth = Layer.succeedContext(
				Auth.makeContext(Auth.of({token: () => Effect.succeed('unused'), user: () => Effect.succeed(DEVELOPER)}))
			)
			const platform = pipe(
				Layer.mergeAll(
					ConfigProvider.layer(ConfigProvider.fromUnknown({APP_URL: 'https://gateway.example'})),
					Layer.succeed(FetchHttpClient.Fetch, (input, init) => upstream.handler(new Request(input, init))),
					layerKeyValueStore(directory),
					auth
				),
				Layer.provideMerge(NodeServices.layer)
			)
			const services = yield* Layer.buildWithMemoMap(
				pipe(
					Gateway.layer,
					Layer.provideMerge(Layer.mergeAll(Connections.layer, layerAiProxy(directory))),
					Layer.provide(McpServer.McpServer.layer),
					Layer.provide(FetchHttpClient.layer),
					Layer.provideMerge(platform)
				),
				memoMap,
				scope
			)
			const added = yield* Context.get(services, Connections).add(
				'https://fixture.example/mcp',
				DEVELOPER,
				Headers.empty
			)
			const gateway = yield* Effect.acquireRelease(
				Effect.sync(() =>
					HttpRouter.toWebHandler(Layer.provide(GatewayMcp, Layer.succeedContext(services)), {memoMap})
				),
				web => Effect.promise(() => web.dispose())
			)
			const transport = new StreamableHTTPClientTransport(new URL('https://gateway.example/mcp'), {
				fetch: (input, init) => gateway.handler(new Request(input, init))
			})
			const client = yield* Effect.acquireRelease(
				Effect.sync(
					() => new Client({name: 'Relay acceptance client', version: '1'}, {versionNegotiation: {mode: 'auto'}})
				),
				value =>
					pipe(
						Effect.promise(() => transport.terminateSession()),
						Effect.andThen(Effect.promise(() => value.close()))
					)
			)
			yield* Effect.promise(() => client.connect(transport))
			const listed = yield* Effect.promise(() => client.listTools())
			if (capture !== undefined) yield* fs.makeDirectory(capture, {recursive: true})
			for (const entry of [
				{name: 'packet', result: PACKET},
				{name: 'document', result: DOCUMENT},
				{name: 'failure', result: FAILURE}
			]) {
				const name = `${added.id}__${entry.name}`
				const descriptor = Option.getOrThrow(Array.findFirst(listed.tools, tool => tool.name === name))
				assert.deepStrictEqual(
					descriptor.outputSchema,
					Option.getOrUndefined(Option.liftPredicate(OUTPUT, () => entry.name !== 'document'))
				)
				const result = yield* Effect.promise(() => client.callTool({arguments: {}, name}))
				const expected = yield* Schema.encodeEffect(McpSchema.CallToolResult)(entry.result)
				assert.deepStrictEqual(
					Struct.pick(result, ['content', 'isError', 'structuredContent']),
					Struct.pick(expected, ['content', 'isError', 'structuredContent'])
				)
				if (entry.name === 'packet') assert.strictEqual(result._meta?.['fixture'], 'preserved')
				yield* captureCall(`relay-${entry.name}`, descriptor, result)
			}
			const effectServices = yield* Layer.buildWithMemoMap(
				pipe(
					McpClient.layerHttp({
						name: 'Effect relay acceptance client',
						protocol: McpProtocol.v2026_07_28,
						url: 'https://gateway.example/mcp',
						version: '1'
					}),
					Layer.provide(FetchHttpClient.layer),
					Layer.provide(
						Layer.succeed(FetchHttpClient.Fetch, (input, init) => gateway.handler(new Request(input, init)))
					)
				),
				yield* Layer.makeMemoMap,
				scope
			)
			const effectClient = Context.get(effectServices, McpClient.McpClient)
			const effectTools = yield* effectClient.listTools()
			for (const entry of [
				{name: 'packet', result: PACKET},
				{name: 'document', result: DOCUMENT},
				{name: 'failure', result: FAILURE}
			]) {
				const descriptor = Option.getOrThrow(
					Array.findFirst(effectTools, tool => tool.name === `${added.id}__${entry.name}`)
				)
				const result = yield* effectClient.callTool({arguments: {}, tool: descriptor})
				assert.deepStrictEqual(
					Struct.pick(result, ['content', 'isError', 'structuredContent']),
					Struct.pick(entry.result, ['content', 'isError', 'structuredContent'])
				)
				yield* captureCall(
					`effect-relay-${entry.name}`,
					yield* Schema.encodeEffect(McpSchema.Tool)(descriptor),
					yield* Schema.encodeEffect(McpSchema.CallToolResult)(result)
				)
			}
			const connectionsTool = Option.getOrThrow(
				Array.findFirst(effectTools, tool => tool.name === 'list_mcp_connections')
			)
			const connectionsResult = yield* effectClient.callTool({
				arguments: {},
				schema: Schema.Struct({servers: Schema.Array(Schema.Struct({id: Schema.String, tools: Schema.Int}))}),
				tool: connectionsTool
			})
			assert.deepStrictEqual(connectionsResult, {servers: [{id: added.id, tools: 3}]})
			const ai = Context.get(services, AiProxy)
			yield* ai.setKey(DEVELOPER.id, 'openrouter', Redacted.make('disposable-fixture-not-an-api-key'))
			assert.lengthOf(yield* ai.keys(DEVELOPER.id), 1)
			for (const entry of [
				{arguments: {}, name: 'list_mcp_connections'},
				{arguments: {provider: 'openrouter'}, name: 'remove_ai_key'},
				{arguments: {server: added.id}, name: 'remove_mcp_server'}
			]) {
				const descriptor = Option.getOrThrow(Array.findFirst(listed.tools, tool => tool.name === entry.name))
				const result = yield* Effect.promise(() => client.callTool(entry))
				assert.isFalse(result.isError)
				assert.deepStrictEqual(result.content, [])
				if (entry.name === 'list_mcp_connections') {
					const data = yield* Schema.decodeUnknownEffect(
						Schema.Struct({servers: Schema.Array(Schema.Struct({id: Schema.String, tools: Schema.Int}))})
					)(result.structuredContent)
					assert.deepStrictEqual(data.servers, [{id: added.id, tools: 3}])
				} else if (entry.name === 'remove_ai_key') {
					assert.deepStrictEqual(result.structuredContent, {provider: 'openrouter'})
				} else {
					assert.deepStrictEqual(result.structuredContent, {server: added.id})
				}
				yield* captureCall(entry.name, descriptor, result)
			}
			assert.lengthOf(yield* ai.keys(DEVELOPER.id), 0)
			assert.lengthOf(yield* Context.get(services, Connections).definitions, 0)
		})
	)
})
