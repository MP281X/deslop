// oxlint-disable-next-line effecttsgo/node-builtin-import -- A scoped loopback server exercises the real socket protocol and its spans.
import {createServer} from 'node:http'

import {NodeHttpServer, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Context,
	Effect,
	FileSystem,
	Layer,
	MutableList,
	Path,
	Predicate,
	Schema,
	Stream,
	String,
	Tracer,
	pipe
} from 'effect'

import {HttpRouter, HttpServer} from 'effect/http'
import {Rpc, RpcClient, RpcGroup, RpcSchema, RpcSerialization} from 'effect/rpc'
import {Socket} from 'effect/socket'

import {layerServerProtocol, layerRpc} from '#server/http.ts'
import {RpcStream, layerRpcStreamClient} from '#shared/rpc.ts'
import {RPC_PATH} from '#shared/schema.ts'

class TestRpcs extends RpcGroup.make(
	Rpc.make('test.echo', {payload: Schema.String, success: Schema.String}),
	Rpc.make('test.watch', {payload: Schema.String, stream: true, success: Schema.String})
).middleware(RpcStream) {}

it.layer(Layer.mergeAll(NodeServices.layer, RpcSerialization.layerSchemaBinary()))('Binary RPC contracts', test => {
	test.effect(
		'runtime envelopes and protocol failures',
		Effect.fnUntraced(function* () {
			const serialization = yield* RpcSerialization.RpcSerialization
			for (const schema of [Schema.Defect(), Schema.Exit(Schema.Never, Schema.Never, Schema.Defect())]) {
				const codec = serialization.codecFor(schema)
				assert.isFunction(Schema.encodeEffect(codec))
				assert.isFunction(Schema.decodeEffect(codec))
			}
			assert.isFunction(serialization.makeUnsafe().encode)
			assert.isFunction(serialization.makeUnsafe().decode)
		})
	)
	test.effect(
		'all app payloads, responses and streams',
		Effect.fnUntraced(function* () {
			const path = yield* Path.Path
			const root = yield* path.fromFileUrl(new URL('../../../../apps/', import.meta.url))
			const contracts = yield* (yield* FileSystem.FileSystem).glob('*/src/rpcs/contracts.ts', {root})
			const serialization = yield* RpcSerialization.RpcSerialization
			assert.isNotEmpty(contracts)
			for (const contract of contracts) {
				const file = path.join(root, contract)
				const loaded: unknown = yield* Effect.promise(() => import(file))
				const module = yield* Schema.decodeUnknownEffect(
					Schema.Struct({
						RpcContracts: Schema.declare(
							(value): value is RpcGroup.RpcGroup<Rpc.AnyWithProps> =>
								Predicate.hasProperty(value, 'requests') &&
								Predicate.isMap(value.requests) &&
								Array.every(Array.fromIterable(value.requests), entry => Rpc.isRpc(entry[1]))
						)
					})
				)(loaded)
				for (const entry of module.RpcContracts.requests) {
					const schemas = MutableList.make<Schema.Top>()
					MutableList.appendAll(schemas, [
						entry[1].payloadSchema,
						entry[1].errorSchema,
						entry[1].defectSchema,
						Rpc.exitSchema(entry[1])
					])
					if (RpcSchema.isStreamSchema(entry[1].successSchema)) {
						MutableList.append(schemas, Schema.NonEmptyArray(entry[1].successSchema.success))
						MutableList.append(schemas, entry[1].successSchema.error)
					} else {
						MutableList.append(schemas, entry[1].successSchema)
					}
					for (const schema of MutableList.toArray(schemas)) {
						const codec = serialization.codecFor(schema)
						assert.isFunction(Schema.encodeEffect(codec))
						assert.isFunction(Schema.decodeEffect(codec))
					}
				}
			}
		})
	)
})

it.layer(NodeServices.layer)('RPC streams', test => {
	test.effect('marks both ends of a stream without auth and leaves a call unmarked', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const spans = MutableList.make<Tracer.NativeSpan>()
				const tracer = Tracer.make({
					span: options => {
						const span = new Tracer.NativeSpan(options)
						MutableList.append(spans, span)
						return span
					}
				})
				const context = yield* Layer.build(
					pipe(
						HttpRouter.serve(
							layerRpc({
								group: TestRpcs,
								handlers: TestRpcs.toLayer({'test.echo': Effect.succeed, 'test.watch': () => Stream.make('tick')})
							})
						),
						Layer.provide(layerServerProtocol),
						Layer.provideMerge(NodeHttpServer.layer(createServer, {host: '127.0.0.1', port: 0})),
						Layer.provide(Layer.succeed(Tracer.Tracer, tracer))
					)
				)
				const origin = HttpServer.formatAddress(Context.get(context, HttpServer.HttpServer).address)
				/* oxlint-disable no-restricted-globals, no-restricted-properties -- Node has no browser origin; scope the real client's origin to the loopback fixture. */
				const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
				yield* Effect.acquireRelease(
					Effect.sync(() => Object.defineProperty(globalThis, 'location', {configurable: true, value: {origin}})),
					() =>
						Effect.sync(() => {
							if (previous === undefined) Reflect.deleteProperty(globalThis, 'location')
							else Object.defineProperty(globalThis, 'location', previous)
						})
				)
				/* oxlint-enable no-restricted-globals, no-restricted-properties */
				const protocol = pipe(
					RpcClient.layerProtocolSocket({pingTimeout: '15 seconds', retryTransientErrors: true}),
					Layer.provide(
						Socket.layerWebSocket(Effect.sync(() => String.replace(/^http/u, 'ws')(`${origin}${RPC_PATH}`)))
					),
					Layer.provide(Socket.layerWebSocketConstructorGlobal),
					Layer.provideMerge(RpcSerialization.layerSchemaBinary()),
					Layer.provideMerge(layerRpcStreamClient)
				)
				yield* pipe(
					Effect.gen(function* () {
						const client = yield* RpcClient.make(TestRpcs, {flatten: true})
						yield* Stream.runDrain(client('test.watch', 'tick'))
						yield* client('test.echo', 'echo')
					}),
					// oxlint-disable-next-line effecttsgo/strict-effect-provide -- The test client owns its socket and closes it with the test's scope.
					Effect.provide(protocol),
					Effect.provideService(Tracer.Tracer, tracer)
				)

				const collected = MutableList.toArray(spans)
				const streamed = Array.filter(collected, span => span.name === 'test.watch')
				assert.lengthOf(streamed, 2)
				assert.isTrue(Array.every(streamed, span => span.attributes.get('rpc.stream') === true))
				assert.isTrue(Array.some(streamed, span => span.kind === 'client'))
				assert.isTrue(Array.some(streamed, span => span.kind === 'server'))
				const called = Array.filter(collected, span => span.name === 'test.echo')
				assert.lengthOf(called, 2)
				assert.isFalse(Array.some(called, span => span.attributes.has('rpc.stream')))
			})
		)
	)
})
