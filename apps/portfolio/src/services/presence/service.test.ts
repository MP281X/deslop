import {assert, it} from '@effect/vitest'

import {Array, Context, Deferred, Effect, Fiber, Layer, Option, Order, Stream, SubscriptionRef, pipe} from 'effect'

import {TestClock} from 'effect/testing'

import type {Scene, Visitors} from './schema.ts'
import {PresenceError, VisitorId} from './schema.ts'
import {Presence} from './service.ts'

function guestAt(x: number, y: number) {
	return (scene: Scene) =>
		Array.some(scene.visitors, visitor => visitor.id === 'guest' && visitor.x === x && visitor.y === y)
}

function idsOf(visitors: Visitors) {
	return pipe(
		visitors,
		Array.map(visitor => visitor.id),
		Array.sort(Order.String)
	)
}

it.effect(
	'binds cursors to joined sockets, preserves second-tab state, and bounds movement and room capacity',
	Effect.fnUntraced(function* () {
		const presence = Context.get(yield* Layer.build(Presence.layer), Presence)
		const seen = yield* SubscriptionRef.make<Scene>({bots: [], visitors: []})
		function watch(id: string, connection: number) {
			return Effect.gen(function* () {
				const ready = yield* Deferred.make<void>()
				const fiber = yield* pipe(
					presence.join({color: '#da702c', id: VisitorId.make(id), name: id}, connection),
					Stream.runForEach(
						Effect.fnUntraced(function* (scene) {
							yield* SubscriptionRef.set(seen, scene)
							yield* Deferred.succeed(ready, undefined)
						})
					),
					Effect.forkScoped
				)
				yield* Deferred.await(ready)
				return fiber
			})
		}
		function until(predicate: (scene: Scene) => boolean) {
			return pipe(
				SubscriptionRef.changes(seen),
				Stream.filter(predicate),
				Stream.runHead,
				Effect.flatMap(Effect.fromOption)
			)
		}

		const observer = yield* watch('observer', 0)
		const firstTab = yield* watch('guest', 1)
		const scene = yield* until(first => Array.length(first.visitors) === 2 && Array.length(first.bots) === 2)
		assert.deepStrictEqual(idsOf(scene.visitors), ['guest', 'observer'])
		assert.deepStrictEqual(idsOf(scene.bots), ['server-alpha', 'server-beta'])

		yield* presence.move({id: VisitorId.make('observer'), x: 0.2, y: 0.3}, 1)
		yield* until(guestAt(0.2, 0.3))
		assert.instanceOf(
			yield* Effect.flip(presence.move({id: VisitorId.make('observer'), x: 0.9, y: 0.9}, 1)),
			PresenceError
		)
		yield* presence.recolor({color: '#4385be', id: VisitorId.make('observer')}, 1)
		assert.isTrue(
			guestAt(
				0.2,
				0.3
			)(
				yield* until(next =>
					Array.some(next.visitors, visitor => visitor.id === 'guest' && visitor.color === '#4385be')
				)
			)
		)

		const secondTab = yield* watch('guest', 2)
		assert.deepStrictEqual(
			Option.getOrThrow(
				Array.findFirst(
					(yield* until(
						next => guestAt(0.2, 0.3)(next) && Array.some(next.visitors, visitor => visitor.color === '#4385be')
					)).visitors,
					visitor => visitor.id === 'observer'
				)
			),
			{color: '#da702c', id: 'observer', name: 'observer', x: 0.5, y: 0.5}
		)
		yield* Fiber.interrupt(firstTab)
		yield* TestClock.adjust('50 millis')
		yield* presence.move({id: VisitorId.make('observer'), x: 0.7, y: 0.7}, 2)
		yield* until(guestAt(0.7, 0.7))

		yield* Fiber.interrupt(secondTab)
		const after = yield* until(next => !Array.some(next.visitors, visitor => visitor.id === 'guest'))
		assert.deepStrictEqual(idsOf(after.visitors), ['observer'])
		assert.deepStrictEqual(idsOf(after.bots), ['server-alpha', 'server-beta'])
		yield* Fiber.interrupt(observer)

		yield* Effect.forEach(Array.range(0, 127), index => watch(`visitor-${index}`, 1000 + index), {
			concurrency: 1,
			discard: true
		})
		assert.instanceOf(
			yield* Effect.flip(
				Stream.runHead(presence.join({color: '#da702c', id: VisitorId.make('overflow'), name: 'Overflow'}, 5000))
			),
			PresenceError
		)
		yield* Effect.forEach(Array.range(0, 127), index => watch('visitor-0', 2000 + index), {
			concurrency: 1,
			discard: true
		})
		assert.instanceOf(
			yield* Effect.flip(
				Stream.runHead(presence.join({color: '#da702c', id: VisitorId.make('visitor-0'), name: 'Extra tab'}, 5001))
			),
			PresenceError
		)
	})
)
