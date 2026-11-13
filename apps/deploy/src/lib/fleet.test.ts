// oxlint-disable-next-line effecttsgo/node-builtin-import -- Exercise the real atom protocol with a scoped loopback server.
import {createServer} from 'node:http'

import {NodeHttpServer, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Cause,
	Context,
	DateTime,
	Duration,
	Effect,
	Fiber,
	Function,
	Layer,
	Match,
	Option,
	Queue,
	Ref,
	Schema,
	Stream,
	pipe
} from 'effect'

import {HttpRouter, HttpServer, HttpServerResponse} from 'effect/http'
import {AsyncResult, AtomRegistry} from 'effect/reactivity'
import type {Atom} from 'effect/reactivity'
import {TestClock} from 'effect/testing'

import {Auth} from '@deslop/runtime/server/auth'
import {layerServerProtocol, layerRpc} from '@deslop/runtime/server/http'
import {AuthError, DEVELOPER, isDenied} from '@deslop/runtime/shared/auth'

import {exposeTargetAtom, inventoryAtom, metricsAtom} from '#lib/fleet.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {DeployError, InventoryItem, Snapshot} from '#services/inventory/schema.ts'
import {MachineHistory} from '#services/metrics/schema.ts'

const fixture = Effect.gen(function* () {
	const opened = yield* Queue.unbounded<number>()
	const closed = yield* Queue.unbounded<number>()
	const hour = yield* Queue.unbounded<MachineHistory[]>()
	const minute = yield* Queue.unbounded<MachineHistory[]>()
	const authorization = yield* Ref.make(Option.none<Cause.Cause<AuthError>>())
	function authenticate() {
		return Effect.flatMap(
			Ref.get(authorization),
			Option.match({onNone: () => Effect.succeed(DEVELOPER), onSome: Effect.failCause})
		)
	}
	const inventory = yield* Queue.unbounded<Effect.Effect<Snapshot, DeployError>>()
	const handlers = RpcContracts.toLayer({
		'exposures.expose': () => Effect.succeed(''),
		'exposures.hide': () => Effect.void,
		'inventory.run': () => Effect.void,
		'inventory.snapshot': () => Effect.succeed(Schema.decodeSync(Snapshot)({items: [], sources: [], time: 1})),
		'inventory.watch': () => Stream.mapEffect(Stream.fromQueue(inventory), Function.identity),
		'metrics.history': () => Effect.never,
		'metrics.watch': query => {
			const source = pipe(
				Match.value(Duration.toMinutes(query.minutes)),
				Match.when(60, () => Stream.fromQueue(hour)),
				Match.when(1, () => Stream.fromQueue(minute)),
				Match.orElse(() => Stream.never)
			)
			return Stream.mapEffect(
				Stream.unwrap(
					Effect.as(
						Effect.acquireRelease(Queue.offer(opened, Duration.toMinutes(query.minutes)), () =>
							Queue.offer(closed, Duration.toMinutes(query.minutes))
						),
						source
					)
				),
				values => {
					if (Array.isArrayEmpty(values)) return DeployError.make({message: 'Range unavailable'})
					return Effect.succeed(values)
				}
			)
		}
	})
	const context = yield* Layer.build(
		pipe(
			HttpRouter.serve(
				Layer.provide(
					Layer.mergeAll(
						layerRpc({group: RpcContracts, handlers}),
						HttpRouter.add(
							'GET',
							'/api/runtime',
							HttpServerResponse.jsonUnsafe({name: 'deploy', traces: '', version: '0.1.0'})
						)
					),
					Layer.succeedContext(
						Auth.makeContext(Auth.of({token: () => Effect.as(authenticate(), 'token'), user: authenticate}))
					)
				)
			),
			Layer.provide(layerServerProtocol),
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
	const watch = Effect.fnUntraced(function* (minutes: 1 | 60) {
		const updates = yield* Queue.unbounded<Atom.Type<ReturnType<typeof metricsAtom>>>()
		yield* Effect.acquireRelease(
			Effect.sync(() =>
				registry.subscribe(
					metricsAtom(Duration.minutes(minutes)),
					value => {
						Queue.offerUnsafe(updates, value)
					},
					{immediate: true}
				)
			),
			unsubscribe => Effect.sync(unsubscribe)
		)
		return {
			current: () => registry.get(metricsAtom(Duration.minutes(minutes))),
			next: (predicate: (value: Atom.Type<ReturnType<typeof metricsAtom>>) => boolean) =>
				pipe(Stream.fromQueue(updates), Stream.filter(predicate), Stream.runHead),
			refresh: () => registry.refresh(metricsAtom(Duration.minutes(minutes)))
		}
	})
	return {authorization, closed, hour, inventory, minute, opened, registry, watch}
})

it.layer(NodeServices.layer)(test => {
	test.effect('reads each range on its own request and keeps its readings through a failed update', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const env = yield* fixture
				const sample = yield* Schema.decodeEffect(MachineHistory)({
					disks: [],
					error: '',
					load: [],
					samples: [],
					stale: false,
					time: 1,
					worker: 'desktop'
				})
				const hour = yield* env.watch(60)
				assert.strictEqual(yield* Queue.take(env.opened), 60)
				yield* Queue.offer(env.hour, [sample])
				yield* hour.next(AsyncResult.isSuccess)
				const minute = yield* env.watch(1)
				assert.strictEqual(yield* Queue.take(env.opened), 1)
				yield* Queue.offer(env.minute, [sample])
				yield* minute.next(AsyncResult.isSuccess)
				const failed = yield* Effect.forkChild(minute.next(AsyncResult.isFailure))
				yield* Queue.offer(env.minute, [])
				assert.isTrue(Option.isSome(yield* Fiber.join(failed)))
				assert.deepStrictEqual(Option.getOrThrow(AsyncResult.value(minute.current())), [sample])
				assert.deepStrictEqual(Option.getOrThrow(AsyncResult.value(hour.current())), [sample])
			})
		)
	)

	test.effect('keeps denied readings hidden across later failures until fresh authorized data arrives', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const env = yield* fixture
				const sample = yield* Schema.decodeEffect(MachineHistory)({
					disks: [],
					error: '',
					load: [],
					samples: [],
					stale: false,
					time: 1,
					worker: 'desktop'
				})
				const minute = yield* env.watch(1)
				assert.strictEqual(yield* Queue.take(env.opened), 1)
				yield* Queue.offer(env.minute, [sample])
				yield* minute.next(AsyncResult.isSuccess)
				yield* Ref.set(
					env.authorization,
					Option.some(Cause.fail(AuthError.make({error: 'access_denied', message: 'Denied'})))
				)
				minute.refresh()
				yield* minute.next(AsyncResult.isFailure)
				assert.isTrue(Option.isNone(AsyncResult.value(minute.current())))
				yield* Ref.set(env.authorization, Option.none())
				minute.refresh()
				assert.strictEqual(yield* Queue.take(env.opened), 1)
				yield* Queue.offer(env.minute, [])
				yield* minute.next(value => AsyncResult.isFailure(value) && value.cause.reasons.length === 2)
				assert.isTrue(Option.isNone(AsyncResult.value(minute.current())))
				assert.isTrue(Option.exists(AsyncResult.error(minute.current()), isDenied))
				minute.refresh()
				assert.strictEqual(yield* Queue.take(env.opened), 1)
				yield* Queue.offer(env.minute, [sample])
				yield* minute.next(AsyncResult.isSuccess)
				assert.deepStrictEqual(Option.getOrThrow(AsyncResult.value(minute.current())), [sample])
			})
		)
	)

	test.effect('shows an auth outage with retained readings and reconnects by itself', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const env = yield* fixture
				const sample = yield* Schema.decodeEffect(MachineHistory)({
					disks: [],
					error: '',
					load: [],
					samples: [],
					stale: false,
					time: 1,
					worker: 'desktop'
				})
				const hour = yield* env.watch(60)
				assert.strictEqual(yield* Queue.take(env.opened), 60)
				yield* Queue.offer(env.hour, [sample])
				yield* hour.next(AsyncResult.isSuccess)
				yield* Ref.set(
					env.authorization,
					Option.some(Cause.fail(AuthError.make({error: 'temporarily_unavailable', message: 'Retry later'})))
				)
				hour.refresh()
				// The first miss could be a dropped socket, so only the retry's second miss marks the outage.
				yield* TestClock.adjust('1 second')
				yield* hour.next(AsyncResult.isFailure)
				assert.isFalse(Option.exists(AsyncResult.error(hour.current()), isDenied))
				assert.deepStrictEqual(Option.getOrThrow(AsyncResult.value(hour.current())), [sample])
				yield* Ref.set(env.authorization, Option.none())
				yield* TestClock.adjust('1 second')
				assert.strictEqual(yield* Queue.take(env.opened), 60)
				yield* Queue.offer(env.hour, [sample])
				yield* hour.next(AsyncResult.isSuccess)
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
				const port = yield* Schema.decodeEffect(InventoryItem)({
					active: false,
					detail: '',
					health: 'quiet',
					id: 'port:3773',
					kind: 'port',
					name: 't3code',
					port: 3773,
					running: false,
					state: 'running',
					url: '',
					worker: 'desktop'
				})
				yield* Queue.offer(
					env.inventory,
					Effect.succeed(
						Snapshot.make({items: [port], sources: [], time: DateTime.makeUnsafe(1), workers: Option.none()})
					)
				)
				yield* pipe(Stream.fromQueue(updates), Stream.filter(AsyncResult.isSuccess), Stream.runHead)
				env.registry.set(exposeTargetAtom, Option.some(port))
				yield* Queue.offer(env.inventory, Effect.fail(DeployError.make({message: 'Unavailable'})))
				yield* pipe(Stream.fromQueue(updates), Stream.filter(AsyncResult.isFailure), Stream.runHead)
				assert.deepStrictEqual(env.registry.get(exposeTargetAtom), Option.some(port))
				assert.isTrue(Option.isSome(AsyncResult.value(env.registry.get(inventoryAtom))))
				yield* Ref.set(
					env.authorization,
					Option.some(
						Cause.fromReasons([
							Cause.makeFailReason(AuthError.make({error: 'temporarily_unavailable', message: 'Unavailable'})),
							Cause.makeFailReason(AuthError.make({error: 'access_denied', message: 'Denied'}))
						])
					)
				)
				env.registry.refresh(inventoryAtom)
				yield* pipe(
					Stream.fromQueue(updates),
					Stream.filter(value => Option.exists(AsyncResult.error(value), isDenied)),
					Stream.runHead
				)
				assert.deepStrictEqual(env.registry.get(exposeTargetAtom), Option.none())
				assert.isTrue(Option.isNone(AsyncResult.value(env.registry.get(inventoryAtom))))
				yield* Ref.set(env.authorization, Option.none())
				env.registry.refresh(inventoryAtom)
				yield* Queue.offer(
					env.inventory,
					Effect.succeed(yield* Schema.decodeEffect(Snapshot)({items: [], sources: [], time: 2}))
				)
				yield* pipe(Stream.fromQueue(updates), Stream.filter(AsyncResult.isSuccess), Stream.runHead)
				assert.deepStrictEqual(env.registry.get(exposeTargetAtom), Option.none())
			})
		)
	)
})
