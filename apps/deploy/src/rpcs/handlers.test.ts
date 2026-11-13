import {assert, it} from '@effect/vitest'

import {Duration, Effect, Fiber, Function, Layer, Queue, Ref, Schema, Stream, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {RpcTest} from 'effect/rpc'

import {Auth} from '@deslop/runtime/server/auth'
import {DEVELOPER} from '@deslop/runtime/shared/auth'

import {PeerRpcAuth, RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Exposures} from '#services/exposures/service.ts'
import {Fleet} from '#services/fleet/service.ts'
import {Snapshot} from '#services/inventory/schema.ts'
import {Inventory} from '#services/inventory/service.ts'
import {MachineHistory} from '#services/metrics/schema.ts'

const localServices = Layer.mergeAll(
	Reactivity.layer,
	Layer.succeed(Inventory, {refresh: Effect.void, run: () => Effect.void, snapshot: Effect.never}),
	Layer.succeed(Exposures, {expose: () => Effect.succeed(''), hide: () => Effect.undefined, items: Effect.succeed([])}),
	Layer.succeed(PeerRpcAuth, PeerRpcAuth.of(Function.identity))
)

it.effect('shares range reads between viewers, isolates ranges and restarts after the last viewer leaves', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const currents = yield* Ref.make(0)
			const entered = yield* Queue.unbounded<number>()
			const closed = yield* Queue.unbounded<number>()
			const first = yield* Queue.unbounded<readonly MachineHistory[]>()
			const second = yield* Queue.unbounded<readonly MachineHistory[]>()
			const history = yield* Schema.decodeEffect(MachineHistory)({
				disks: [],
				error: '',
				load: [],
				samples: [],
				stale: false,
				time: 1,
				worker: 'desktop'
			})
			const fleet = Fleet.of({
				current: () =>
					pipe(
						currents,
						Ref.update(count => count + 1),
						Effect.as([history])
					),
				expose: () => Effect.succeed(''),
				hide: () => Effect.void,
				history: () => Effect.succeed(history),
				local: Effect.succeed(yield* Schema.decodeEffect(Snapshot)({items: [], sources: [], time: 1, workers: []})),
				metrics: Effect.fnUntraced(function* (query) {
					return yield* pipe(
						entered,
						Queue.offer(Duration.toMinutes(query.minutes)),
						Effect.andThen(Effect.never),
						Effect.onInterrupt(() => Queue.offer(closed, Duration.toMinutes(query.minutes)))
					)
				}),
				run: () => Effect.void,
				snapshot: Effect.never
			})
			const context = yield* Layer.build(
				pipe(
					RpcHandlers,
					Layer.provideMerge(localServices),
					Layer.provide(Layer.succeed(Fleet, fleet)),
					Layer.provideMerge(
						Layer.succeedContext(
							Auth.makeContext(Auth.of({token: () => Effect.succeed('token'), user: () => Effect.succeed(DEVELOPER)}))
						)
					)
				)
			)
			const client = yield* Effect.provideContext(RpcTest.makeClient(RpcContracts, {flatten: true}), context)
			assert.strictEqual(yield* Ref.get(currents), 0)
			const one = yield* pipe(
				client('metrics.watch', {minutes: Duration.minutes(60)}),
				Stream.runForEach(values => Queue.offer(first, values)),
				Effect.forkChild
			)
			assert.deepStrictEqual(yield* Queue.take(first), [history])
			assert.strictEqual(yield* Queue.take(entered), 60)
			const two = yield* pipe(
				client('metrics.watch', {minutes: Duration.minutes(60)}),
				Stream.runForEach(values => Queue.offer(second, values)),
				Effect.forkChild
			)
			assert.deepStrictEqual(yield* Queue.take(second), [history])
			assert.strictEqual(yield* Ref.get(currents), 1)
			yield* Fiber.interrupt(one)
			assert.strictEqual(yield* Queue.size(closed), 0)
			const other = yield* Effect.forkChild(Stream.runDrain(client('metrics.watch', {minutes: Duration.minutes(10)})))
			assert.strictEqual(yield* Queue.take(entered), 10)
			assert.strictEqual(yield* Ref.get(currents), 2)
			yield* Fiber.interrupt(two)
			assert.strictEqual(yield* Queue.take(closed), 60)
			const rejoined = yield* Effect.forkChild(
				Stream.runDrain(client('metrics.watch', {minutes: Duration.minutes(60)}))
			)
			assert.strictEqual(yield* Queue.take(entered), 60)
			assert.strictEqual(yield* Ref.get(currents), 3)
			yield* Fiber.interrupt(rejoined)
			assert.strictEqual(yield* Queue.take(closed), 60)
			yield* Fiber.interrupt(other)
			assert.strictEqual(yield* Queue.take(closed), 10)
		})
	)
)

it.effect('collects inventory once for multiple viewers and stops after the last viewer leaves', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const locals = yield* Ref.make(0)
			const entered = yield* Queue.unbounded<void>()
			const closed = yield* Queue.unbounded<void>()
			const received = yield* Queue.unbounded<Snapshot>()
			const snapshot = yield* Schema.decodeEffect(Snapshot)({items: [], sources: [], time: 1, workers: []})
			const context = yield* Layer.build(
				pipe(
					RpcHandlers,
					Layer.provideMerge(localServices),
					Layer.provide(
						Layer.succeed(
							Fleet,
							Fleet.of({
								current: () => Effect.never,
								expose: () => Effect.succeed(''),
								hide: () => Effect.void,
								history: () => Effect.never,
								local: pipe(
									locals,
									Ref.update(count => count + 1),
									Effect.as(snapshot)
								),
								metrics: () => Effect.never,
								run: () => Effect.void,
								snapshot: pipe(
									entered,
									Queue.offer(undefined),
									Effect.andThen(Effect.never),
									Effect.onInterrupt(() => Queue.offer(closed, undefined))
								)
							})
						)
					),
					Layer.provideMerge(
						Layer.succeedContext(
							Auth.makeContext(Auth.of({token: () => Effect.succeed('token'), user: () => Effect.succeed(DEVELOPER)}))
						)
					)
				)
			)
			const client = yield* Effect.provideContext(RpcTest.makeClient(RpcContracts, {flatten: true}), context)
			const one = yield* pipe(
				client('inventory.watch', undefined),
				Stream.runForEach(value => Queue.offer(received, value)),
				Effect.forkChild
			)
			assert.deepStrictEqual(yield* Queue.take(received), snapshot)
			yield* Queue.take(entered)
			const two = yield* pipe(
				client('inventory.watch', undefined),
				Stream.runForEach(value => Queue.offer(received, value)),
				Effect.forkChild
			)
			assert.deepStrictEqual(yield* Queue.take(received), snapshot)
			assert.strictEqual(yield* Ref.get(locals), 1)
			yield* Fiber.interrupt(one)
			assert.strictEqual(yield* Queue.size(closed), 0)
			yield* Fiber.interrupt(two)
			yield* Queue.take(closed)
		})
	)
)
