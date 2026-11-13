import {assert, it} from '@effect/vitest'

import {Effect, Fiber, Layer, Queue, Ref, Stream, pipe} from 'effect'

import {RpcTest} from 'effect/rpc'

import {Auth} from '@deslop/runtime/server/auth'
import {DEVELOPER} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Fleet} from '#services/fleet/service.ts'
import {Snapshot} from '#services/inventory/schema.ts'
import {MachineHistory} from '#services/metrics/schema.ts'

it.effect('shares range reads between viewers, isolates ranges and restarts after the last viewer leaves', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const currents = yield* Ref.make(0)
			const entered = yield* Queue.unbounded<number>()
			const closed = yield* Queue.unbounded<number>()
			const first = yield* Queue.unbounded<readonly MachineHistory[]>()
			const second = yield* Queue.unbounded<readonly MachineHistory[]>()
			const history = MachineHistory.make({error: '', samples: [], stale: false, time: 1, worker: 'desktop'})
			const fleet = Fleet.of({
				current: () =>
					Effect.as(
						Ref.update(currents, count => count + 1),
						[history]
					),
				expose: () => Effect.succeed(''),
				hide: () => Effect.void,
				history: () => Effect.succeed(history),
				local: Effect.succeed(Snapshot.make({items: [], sources: [], time: 1})),
				metrics: query =>
					Effect.onInterrupt(Effect.andThen(Queue.offer(entered, query.minutes), Effect.never), () =>
						Queue.offer(closed, query.minutes)
					),
				run: () => Effect.void,
				snapshot: Effect.never
			})
			const context = yield* Layer.build(
				pipe(
					RpcHandlers,
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
			const one = yield* Effect.forkChild(
				Stream.runForEach(client('metrics.watch', {minutes: 60}), values => Queue.offer(first, values))
			)
			assert.deepStrictEqual(yield* Queue.take(first), [history])
			assert.strictEqual(yield* Queue.take(entered), 60)
			const two = yield* Effect.forkChild(
				Stream.runForEach(client('metrics.watch', {minutes: 60}), values => Queue.offer(second, values))
			)
			assert.deepStrictEqual(yield* Queue.take(second), [history])
			assert.strictEqual(yield* Ref.get(currents), 1)
			yield* Fiber.interrupt(one)
			assert.strictEqual(yield* Queue.size(closed), 0)
			const other = yield* Effect.forkChild(Stream.runDrain(client('metrics.watch', {minutes: 10})))
			assert.strictEqual(yield* Queue.take(entered), 10)
			assert.strictEqual(yield* Ref.get(currents), 2)
			yield* Fiber.interrupt(two)
			assert.strictEqual(yield* Queue.take(closed), 60)
			const rejoined = yield* Effect.forkChild(Stream.runDrain(client('metrics.watch', {minutes: 60})))
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
			const snapshot = Snapshot.make({items: [], sources: [], time: 1})
			const context = yield* Layer.build(
				pipe(
					RpcHandlers,
					Layer.provide(
						Layer.succeed(
							Fleet,
							Fleet.of({
								current: () => Effect.never,
								expose: () => Effect.succeed(''),
								hide: () => Effect.void,
								history: () => Effect.never,
								local: Effect.as(
									Ref.update(locals, count => count + 1),
									snapshot
								),
								metrics: () => Effect.never,
								run: () => Effect.void,
								snapshot: Effect.onInterrupt(Effect.andThen(Queue.offer(entered, undefined), Effect.never), () =>
									Queue.offer(closed, undefined)
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
			const one = yield* Effect.forkChild(
				Stream.runForEach(client('inventory.watch', undefined), value => Queue.offer(received, value))
			)
			assert.deepStrictEqual(yield* Queue.take(received), snapshot)
			yield* Queue.take(entered)
			const two = yield* Effect.forkChild(
				Stream.runForEach(client('inventory.watch', undefined), value => Queue.offer(received, value))
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
