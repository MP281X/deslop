// oxlint-disable-next-line effecttsgo/node-builtin-import -- A scoped loopback server exercises the real socket protocol and its spans.
import {createServer} from 'node:http'

import {NodeHttpServer, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Context, Effect, Layer, MutableList, Schema, Stream, String, Tracer, pipe} from 'effect'

import {HttpRouter, HttpServer} from 'effect/http'
import {Rpc, RpcClient, RpcGroup, RpcSerialization} from 'effect/rpc'
import {Socket} from 'effect/socket'

import {RpcStream, layerRpcStreamClient} from '#rpc.ts'
import {RPC_PATH} from '#schema.ts'
import {layerProtocol, layerRpc} from '#server.ts'

class TestRpcs extends RpcGroup.make(
	Rpc.make('test.echo', {payload: Schema.String, success: Schema.String}),
	Rpc.make('test.watch', {payload: Schema.String, stream: true, success: Schema.String})
).middleware(RpcStream) {}

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
						Layer.provide(layerProtocol),
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
