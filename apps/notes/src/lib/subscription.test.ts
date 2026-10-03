import {NodeHttpClient, NodeHttpServer, NodeServices, NodeSocket} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	ConfigProvider,
	Context,
	Deferred,
	Effect,
	Fiber,
	FileSystem,
	Layer,
	Option,
	Queue,
	Stream,
	pipe
} from 'effect'

import {HttpRouter, HttpServer} from 'effect/http'
import {NetAddress} from 'effect/net'
import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'
import * as Rpc from 'effect/rpc'
import {Socket} from 'effect/socket'

import {notesAtom, RpcClient} from '#lib/utils.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Sources} from '#services/notes/internal/extraction.ts'
import {Organizer} from '#services/notes/internal/organization.ts'
import type {NotesState} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'

const observed = Effect.fnUntraced(function* (
	registry: AtomRegistry.AtomRegistry,
	predicate: (result: Atom.Type<typeof notesAtom>) => boolean
) {
	return yield* pipe(
		AtomRegistry.toStream(registry, notesAtom),
		Stream.filter(predicate),
		Stream.runHead,
		Effect.map(Option.getOrThrow),
		Effect.timeout('5 seconds')
	)
})

const wire = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem
	const directory = yield* fs.makeTempDirectoryScoped()
	const notes = pipe(
		Notes.layer,
		Layer.provide(Sources.layer),
		Layer.provide(Organizer.layer),
		Layer.provide(NodeHttpClient.layerFetch),
		Layer.provide(NodeServices.layer),
		Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({NOTES_DATA_DIR: directory})))
	)
	const serverContext = yield* Layer.build(
		pipe(
			HttpRouter.serve(
				pipe(
					Rpc.RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
					Layer.provide(RpcHandlers),
					Layer.provide(notes)
				),
				{disableListenLog: true, disableLogger: true}
			),
			Layer.provide(Rpc.RpcSerialization.layerJson),
			Layer.provideMerge(NodeHttpServer.layerTest)
		)
	)
	const address = Context.get(serverContext, HttpServer.HttpServer).address
	if (!NetAddress.isInetAddress(address)) return yield* Effect.die('Expected a TCP test server')
	const sockets = yield* Queue.make<NodeSocket.NodeWS.WebSocket>()
	const protocol = pipe(
		Rpc.RpcClient.layerProtocolSocket({retryTransientErrors: true}),
		Layer.provide(
			pipe(
				Socket.layerWebSocket(`ws://127.0.0.1:${address.port}/api/rpc`),
				Layer.provide(
					Layer.succeed(Socket.WebSocketConstructor, url => {
						const socket = new NodeSocket.NodeWS.WebSocket(url)
						Queue.offerUnsafe(sockets, socket)
						return socket
					})
				)
			)
		),
		Layer.provide(Rpc.RpcSerialization.layerJson)
	)
	const clientLayer = pipe(
		Layer.effect(RpcClient, Rpc.RpcClient.make(RpcContracts, {flatten: true})),
		Layer.provide(protocol)
	)
	const open = Effect.acquireRelease(
		Effect.sync(() => AtomRegistry.make({initialValues: [Atom.initialValue(RpcClient.runtime.layer, clientLayer)]})),
		registry => Effect.sync(() => registry.dispose())
	)
	return {clientLayer, open, sockets}
})

it.layer(NodeServices.layer, {excludeTestServices: true})('Subscriptions', test => {
	test.effect(
		're-subscribes both libraries after repeated socket loss without losing notes or replaying a mutation',
		() =>
			Effect.gen(function* () {
				const fixture = yield* wire
				const first = yield* fixture.open
				const second = yield* fixture.open
				yield* observed(first, AsyncResult.isSuccess)
				const firstSocket = yield* Queue.take(fixture.sockets)
				yield* observed(second, AsyncResult.isSuccess)
				const secondSocket = yield* Queue.take(fixture.sockets)
				const firstContext = yield* AtomRegistry.getResult(first, RpcClient.runtime)
				const secondContext = yield* AtomRegistry.getResult(second, RpcClient.runtime)
				const firstClient = Context.get(firstContext, RpcClient)
				const secondClient = Context.get(secondContext, RpcClient)
				const note = yield* secondClient('notes.capture', {text: 'subscription-wire-first'})
				function contains(result: Atom.Type<typeof notesAtom>) {
					return AsyncResult.isSuccess(result) && Array.some(result.value.notes, entry => entry.id === note.id)
				}
				yield* observed(first, contains)
				yield* observed(second, contains)
				yield* Effect.sync(() => firstSocket.terminate())
				const unavailable = yield* observed(first, AsyncResult.isFailure)
				assert.isTrue(
					Array.some(pipe(AsyncResult.value(unavailable), Option.getOrThrow).notes, entry => entry.id === note.id)
				)
				const offline = yield* Effect.flip(firstClient('notes.capture', {text: 'subscription-wire-must-not-replay'}))
				assert.strictEqual(offline._tag, 'RpcClientError')
				const added = yield* secondClient('notes.capture', {text: 'subscription-wire-second'})
				function current(result: Atom.Type<typeof notesAtom>) {
					return AsyncResult.isSuccess(result) && Array.some(result.value.notes, entry => entry.id === added.id)
				}
				yield* observed(first, current)
				yield* observed(second, current)
				const recoveredSocket = yield* Queue.take(fixture.sockets)
				yield* Effect.sync(() => secondSocket.terminate())
				yield* observed(second, AsyncResult.isFailure)
				yield* firstClient('notes.edit', {id: note.id, tags: ['wire'], title: 'Recovered edit'})
				function edited(result: Atom.Type<typeof notesAtom>) {
					return (
						AsyncResult.isSuccess(result) && Array.some(result.value.notes, entry => entry.title === 'Recovered edit')
					)
				}
				yield* observed(first, edited)
				yield* observed(second, edited)
				yield* Queue.take(fixture.sockets)
				yield* Effect.sync(() => recoveredSocket.terminate())
				yield* observed(first, AsyncResult.isFailure)
				yield* secondClient('notes.remove', {id: note.id})
				function removed(result: Atom.Type<typeof notesAtom>) {
					return AsyncResult.isSuccess(result) && !Array.some(result.value.notes, entry => entry.id === note.id)
				}
				const final = yield* observed(first, removed)
				yield* observed(second, removed)
				assert.deepStrictEqual(pipe(AsyncResult.value(final), Option.getOrThrow).notes, [added])
			}),
		20_000
	)

	test.effect('reopens a cancelled watch on the same healthy connection and keeps concurrent updates alive', () =>
		Effect.gen(function* () {
			const fixture = yield* wire
			const context = yield* Layer.build(fixture.clientLayer)
			const client = Context.get(context, RpcClient)
			yield* Effect.forEach(
				Array.range(1, 6),
				Effect.fnUntraced(function* () {
					const ready = yield* Deferred.make<NotesState>()
					const watch = yield* pipe(
						client('notes.watch', undefined),
						Stream.runForEach(state => Deferred.succeed(ready, state)),
						Effect.forkChild
					)
					yield* pipe(Deferred.await(ready), Effect.timeout('2 seconds'))
					yield* Fiber.interrupt(watch)
				})
			)
			const first = yield* client('notes.watch', undefined, {asQueue: true})
			const second = yield* client('notes.watch', undefined, {asQueue: true})
			yield* pipe(Queue.take(first), Effect.timeout('2 seconds'))
			yield* pipe(Queue.take(second), Effect.timeout('2 seconds'))
			const note = yield* client('notes.capture', {text: 'same-connection-watch'})
			for (const updates of [first, second]) {
				const state = yield* pipe(
					Stream.fromQueue(updates),
					Stream.filter(value => Array.some(value.notes, entry => entry.id === note.id && entry.status === 'saved')),
					Stream.runHead,
					Effect.map(Option.getOrThrow),
					Effect.timeout('2 seconds')
				)
				assert.deepStrictEqual(state.notes, [note])
			}
			yield* client('notes.remove', {id: note.id})
			for (const updates of [first, second]) {
				const state = yield* pipe(Queue.take(updates), Effect.timeout('2 seconds'))
				assert.deepStrictEqual(state.notes, [])
			}
			const socket = yield* Queue.take(fixture.sockets)
			assert.strictEqual(socket.readyState, NodeSocket.NodeWS.WebSocket.OPEN)
			assert.strictEqual(yield* Queue.size(fixture.sockets), 0)
		})
	)
})
