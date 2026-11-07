// oxlint-disable-next-line effecttsgo/node-builtin-import -- Exercise the real atom protocol with a scoped loopback server.
import {createServer} from 'node:http'

import {NodeHttpServer, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Context, Effect, Fiber, Function, Layer, Match, Option, Queue, Ref, Stream, pipe} from 'effect'

import {HttpRouter, HttpServer, HttpServerResponse} from 'effect/http'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'
import type {Atom} from 'effect/reactivity'
import {TestClock} from 'effect/testing'

import {AuthError} from '@deslop/runtime/auth/schema'
import {Auth} from '@deslop/runtime/auth/service'
import {DEVELOPER, isDenied} from '@deslop/runtime/auth/utils'
import * as ServerRuntime from '@deslop/runtime/server'

import {exposeTargetAtom, inventoryAtom, metricsAtom, minutesAtom} from '#lib/utils.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {DeployError, InventoryItem, Snapshot} from '#services/inventory/schema.ts'
import {MachineHistory} from '#services/metrics/schema.ts'

const fixture = Effect.gen(function* () {
	const opened = yield* Queue.unbounded<number>()
	const closed = yield* Queue.unbounded<number>()
	const hour = yield* Queue.unbounded<MachineHistory[]>()
	const minute = yield* Queue.unbounded<MachineHistory[]>()
	const authorization = yield* Ref.make(Option.none<AuthError>())
	function authenticate() {
		return Effect.flatMap(
			Ref.get(authorization),
			Option.match({onNone: () => Effect.succeed(DEVELOPER), onSome: Effect.fail})
		)
	}
	const inventory = yield* Queue.unbounded<Effect.Effect<Snapshot, DeployError>>()
	const handlers = RpcContracts.toLayer({
		'deploy.expose': () => Effect.succeed(''),
		'deploy.hide': () => Effect.void,
		'deploy.history': () => Effect.never,
		'deploy.inventory': () => pipe(Stream.fromQueue(inventory), Stream.mapEffect(Function.identity)),
		'deploy.metrics': query => {
			const source = pipe(
				Match.value(query.minutes),
				Match.when(60, () => Stream.fromQueue(hour)),
				Match.when(1, () => Stream.fromQueue(minute)),
				Match.orElse(() => Stream.never)
			)
			return pipe(
				Stream.unwrap(
					Effect.as(
						Effect.acquireRelease(Queue.offer(opened, query.minutes), () => Queue.offer(closed, query.minutes)),
						source
					)
				),
				Stream.mapEffect(values => {
					if (Array.isArrayEmpty(values)) return DeployError.make({message: 'Range unavailable'})
					return Effect.succeed(values)
				})
			)
		},
		'deploy.run': () => Effect.void,
		'deploy.snapshot': () => Effect.succeed(Snapshot.make({items: [], sources: [], time: 1}))
	})
	const context = yield* Layer.build(
		pipe(
			HttpRouter.serve(
				pipe(
					Layer.mergeAll(
						ServerRuntime.layerRpc({group: RpcContracts, handlers}),
						HttpRouter.add(
							'GET',
							'/api/runtime',
							HttpServerResponse.jsonUnsafe({name: 'deploy', traces: '', version: '0.1.0'})
						)
					),
					Layer.provide(Layer.succeedContext(Auth.makeContext(Auth.of({access: authenticate, user: authenticate}))))
				)
			),
			Layer.provide(ServerRuntime.layerProtocol),
			Layer.provideMerge(NodeHttpServer.layer(createServer, {host: '127.0.0.1', port: 0}))
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
	const registry = yield* Effect.acquireRelease(
		Effect.sync(() => AtomRegistry.make()),
		value => Effect.sync(() => value.dispose())
	)
	const updates = yield* Queue.unbounded<Atom.Type<typeof metricsAtom>>()
	yield* Effect.acquireRelease(
		Effect.sync(() =>
			registry.subscribe(
				metricsAtom,
				value => {
					Queue.offerUnsafe(updates, value)
				},
				{immediate: true}
			)
		),
		unsubscribe => Effect.sync(unsubscribe)
	)
	return {authorization, closed, hour, inventory, minute, opened, registry, updates}
})

it.layer(NodeServices.layer)(test => {
	test.effect('keeps the last loaded range across superseded requests and a failed replacement', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const env = yield* fixture
				assert.strictEqual(yield* Queue.take(env.opened), 60)
				const sample = MachineHistory.make({error: '', samples: [], stale: false, time: 1, worker: 'desktop'})
				yield* Queue.offer(env.hour, [sample])
				yield* pipe(Stream.fromQueue(env.updates), Stream.filter(AsyncResult.isSuccess), Stream.runHead)
				assert.deepStrictEqual(Option.getOrThrow(AsyncResult.value(env.registry.get(metricsAtom))), {
					histories: [sample],
					minutes: 60
				})
				env.registry.set(minutesAtom, 10)
				assert.strictEqual(yield* Queue.take(env.opened), 10)
				env.registry.set(minutesAtom, 1)
				assert.strictEqual(yield* Queue.take(env.opened), 1)
				assert.deepStrictEqual([yield* Queue.take(env.closed), yield* Queue.take(env.closed)], [60, 10])
				assert.strictEqual(Option.getOrThrow(AsyncResult.value(env.registry.get(metricsAtom))).minutes, 60)
				yield* Queue.offer(env.minute, [sample])
				yield* pipe(
					Stream.fromQueue(env.updates),
					Stream.filter(value => Option.exists(AsyncResult.value(value), loaded => loaded.minutes === 1)),
					Stream.runHead
				)
				assert.strictEqual(Option.getOrThrow(AsyncResult.value(env.registry.get(metricsAtom))).minutes, 1)
				const failed = yield* Effect.forkChild(
					pipe(Stream.fromQueue(env.updates), Stream.filter(AsyncResult.isFailure), Stream.runHead)
				)
				yield* Queue.offer(env.minute, [])
				assert.isTrue(Option.isSome(yield* Fiber.join(failed)))
				assert.strictEqual(Option.getOrThrow(AsyncResult.value(env.registry.get(metricsAtom))).minutes, 1)
			})
		)
	)

	test.effect('keeps denied ranges hidden across later failures until fresh authorized data arrives', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const env = yield* fixture
				assert.strictEqual(yield* Queue.take(env.opened), 60)
				const sample = MachineHistory.make({error: '', samples: [], stale: false, time: 1, worker: 'desktop'})
				yield* Queue.offer(env.hour, [sample])
				yield* pipe(Stream.fromQueue(env.updates), Stream.filter(AsyncResult.isSuccess), Stream.runHead)
				yield* Ref.set(env.authorization, Option.some(AuthError.make({error: 'access_denied', message: 'Denied'})))
				env.registry.set(minutesAtom, 10)
				yield* pipe(Stream.fromQueue(env.updates), Stream.filter(AsyncResult.isFailure), Stream.runHead)
				assert.isTrue(Option.isNone(AsyncResult.value(env.registry.get(metricsAtom))))
				yield* Ref.set(env.authorization, Option.none())
				env.registry.set(minutesAtom, 1)
				assert.strictEqual(yield* Queue.take(env.opened), 1)
				yield* Queue.offer(env.minute, [])
				yield* pipe(
					Stream.fromQueue(env.updates),
					Stream.filter(value => AsyncResult.isFailure(value) && value.cause.reasons.length === 2),
					Stream.runHead
				)
				assert.isTrue(Option.isNone(AsyncResult.value(env.registry.get(metricsAtom))))
				assert.isTrue(Option.exists(AsyncResult.error(env.registry.get(metricsAtom)), isDenied))
				env.registry.refresh(metricsAtom)
				assert.strictEqual(yield* Queue.take(env.opened), 1)
				yield* Queue.offer(env.minute, [sample])
				yield* pipe(Stream.fromQueue(env.updates), Stream.filter(AsyncResult.isSuccess), Stream.runHead)
				assert.strictEqual(Option.getOrThrow(AsyncResult.value(env.registry.get(metricsAtom))).minutes, 1)
			})
		)
	)

	test.effect('shows an auth outage with retained readings and reconnects without a range change', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const env = yield* fixture
				assert.strictEqual(yield* Queue.take(env.opened), 60)
				const sample = MachineHistory.make({error: '', samples: [], stale: false, time: 1, worker: 'desktop'})
				yield* Queue.offer(env.hour, [sample])
				yield* pipe(Stream.fromQueue(env.updates), Stream.filter(AsyncResult.isSuccess), Stream.runHead)
				yield* Ref.set(
					env.authorization,
					Option.some(AuthError.make({error: 'temporarily_unavailable', message: 'Retry later'}))
				)
				env.registry.set(minutesAtom, 1)
				yield* pipe(Stream.fromQueue(env.updates), Stream.filter(AsyncResult.isFailure), Stream.runHead)
				const outage = env.registry.get(metricsAtom)
				assert.isFalse(Option.exists(AsyncResult.error(outage), isDenied))
				assert.strictEqual(Option.getOrThrow(AsyncResult.value(outage)).minutes, 60)
				yield* Ref.set(env.authorization, Option.none())
				yield* TestClock.adjust('1 second')
				assert.strictEqual(yield* Queue.take(env.opened), 1)
				yield* Queue.offer(env.minute, [sample])
				yield* pipe(Stream.fromQueue(env.updates), Stream.filter(AsyncResult.isSuccess), Stream.runHead)
				assert.strictEqual(Option.getOrThrow(AsyncResult.value(env.registry.get(metricsAtom))).minutes, 1)
			})
		)
	)

	test.effect('keeps an exposure target during an outage and closes it when access is denied', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const env = yield* fixture
				env.registry.mount(exposeTargetAtom)
				const updates = yield* Queue.unbounded<Atom.Type<typeof inventoryAtom>>()
				env.registry.subscribe(
					inventoryAtom,
					value => {
						Queue.offerUnsafe(updates, value)
					},
					{immediate: true}
				)
				const port = InventoryItem.make({
					detail: '',
					id: 'port:3773',
					kind: 'port',
					name: 't3code',
					port: 3773,
					state: 'running',
					url: '',
					worker: 'desktop'
				})
				yield* Queue.offer(env.inventory, Effect.succeed(Snapshot.make({items: [port], sources: [], time: 1})))
				yield* pipe(Stream.fromQueue(updates), Stream.filter(AsyncResult.isSuccess), Stream.runHead)
				env.registry.set(exposeTargetAtom, Option.some(port))
				yield* Queue.offer(env.inventory, Effect.fail(DeployError.make({message: 'Unavailable'})))
				yield* pipe(Stream.fromQueue(updates), Stream.filter(AsyncResult.isFailure), Stream.runHead)
				assert.deepStrictEqual(env.registry.get(exposeTargetAtom), Option.some(port))
				assert.isTrue(Option.isSome(AsyncResult.value(env.registry.get(inventoryAtom))))
				yield* Ref.set(env.authorization, Option.some(AuthError.make({error: 'access_denied', message: 'Denied'})))
				env.registry.refresh(inventoryAtom)
				yield* pipe(
					Stream.fromQueue(updates),
					Stream.filter(value => Option.exists(AsyncResult.error(value), isDenied)),
					Stream.runHead
				)
				assert.deepStrictEqual(env.registry.get(exposeTargetAtom), Option.none())
				assert.isTrue(Option.isNone(AsyncResult.value(env.registry.get(inventoryAtom))))
			})
		)
	)
})
