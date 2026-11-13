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
	Record,
	Redacted,
	Schema,
	Struct,
	pipe
} from 'effect'

import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client'
import type {Tool} from '@modelcontextprotocol/client'
import {McpClient, McpProtocol, McpSchema, McpServer} from 'effect/ai'
import {FetchHttpClient, Headers, HttpRouter} from 'effect/http'

import {Auth} from '@deslop/runtime/server/auth'
import {layerDataStore} from '@deslop/runtime/server/store'
import {DEVELOPER} from '@deslop/runtime/shared/auth'

import {AiProxy} from '#services/ai/service.ts'
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
const CASES = [
	{name: 'packet', result: PACKET},
	{name: 'document', result: DOCUMENT},
	{name: 'failure', result: FAILURE}
]

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
				return Effect.forEach(
					[
						{part: 'list', value: descriptor},
						{part: 'call', value: result}
					],
					entry =>
						Effect.flatMap(Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(entry.value), encoded => fs.writeFileString(`${capture}/${name}.${entry.part}.json`, encoded)),
					{concurrency: 1, discard: true}
				)
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
									for (const entry of CASES) {
										yield* registry.addTool({
											annotations: Context.empty(),
											handle: () => Effect.succeed(entry.result),
											tool: McpSchema.Tool.make({
												inputSchema: {type: 'object'},
												name: entry.name,
												...pipe(OUTPUT, Option.liftPredicate(() => entry.name !== 'document'), pipelineSubject3723 => Option.match(pipelineSubject3723, {onNone: () => ({}), onSome: outputSchema => ({outputSchema})}))
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
			const platform = Layer.provideMerge(Layer.mergeAll(
					ConfigProvider.layer(ConfigProvider.fromUnknown({APP_URL: 'https://gateway.example'})),
					Layer.succeed(FetchHttpClient.Fetch, (input, init) => upstream.handler(new Request(input, init))),
					layerDataStore(directory),
					auth
				), NodeServices.layer)
			const services = yield* Layer.buildWithMemoMap(
				pipe(
					Gateway.layer,
					Layer.provideMerge(Layer.mergeAll(Connections.layer, AiProxy.layer)),
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
					Effect.andThen(Effect.promise(() => transport.terminateSession()), Effect.promise(() => value.close()))
			)
			yield* Effect.promise(() => client.connect(transport))

			const sdkTools = pipe(
				(yield* Effect.promise(() => client.listTools())).tools,
				Array.groupBy(tool => tool.name),
				Record.map(Array.headNonEmpty)
			)
			if (capture !== undefined) yield* fs.makeDirectory(capture, {recursive: true})
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
			const effectTools = pipe(
				yield* effectClient.listTools(),
				Array.groupBy(tool => tool.name),
				Record.map(Array.headNonEmpty)
			)
			const encodedEffectTools = yield* Schema.encodeEffect(Schema.Record(Schema.String, McpSchema.Tool))(effectTools)
			for (const probe of [
				{
					call: (name: string) => Effect.promise(() => client.callTool({arguments: {}, name})),
					label: 'relay',
					tools: sdkTools
				},
				{
					call: Effect.fnUntraced(function* (name: string) {
						const result = yield* effectClient.callTool({
							arguments: {},
							tool: pipe(effectTools, Record.get(name), Option.getOrThrow)
						})
						return yield* Schema.encodeEffect(McpSchema.CallToolResult)(result)
					}),
					label: 'effect-relay',
					tools: encodedEffectTools
				}
			]) {
				for (const entry of CASES) {
					const name = `${added.id}__${entry.name}`
					const descriptor = pipe(
						Record.get<string, Tool | typeof McpSchema.Tool.Encoded>(probe.tools, name),
						Option.getOrThrow
					)
					assert.deepStrictEqual(
						descriptor.outputSchema,
						Option.getOrUndefined(Option.liftPredicate(OUTPUT, () => entry.name !== 'document'))
					)
					const result = yield* probe.call(name)
					const expected = yield* Schema.encodeEffect(McpSchema.CallToolResult)(entry.result)
					assert.deepStrictEqual(
						Struct.pick(result, ['content', 'isError', 'structuredContent']),
						Struct.pick(expected, ['content', 'isError', 'structuredContent'])
					)
					if (entry.name === 'packet') assert.strictEqual(result._meta?.['fixture'], 'preserved')
					yield* captureCall(`${probe.label}-${entry.name}`, descriptor, result)
				}
			}
			const connectionsTool = pipe(effectTools, Record.get('list_mcp_connections'), Option.getOrThrow)
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
				const descriptor = pipe(sdkTools, Record.get(entry.name), Option.getOrThrow)
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
