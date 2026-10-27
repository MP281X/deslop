import {assert, it} from '@effect/vitest'

import {Array, Context, Effect, Fiber, Layer, Order, Stream, SubscriptionRef, pipe} from 'effect'

import type {PortfolioVisitors} from '#services/presence/schema.ts'
import {Presence} from '#services/presence/service.ts'

function guestAt(x: number, y: number) {
	return (visitors: PortfolioVisitors) =>
		Array.some(visitors, visitor => visitor.id === 'guest' && visitor.x === x && visitor.y === y)
}

function idsOf(visitors: PortfolioVisitors) {
	return Array.sort(
		Array.map(visitors, visitor => visitor.id),
		Order.String
	)
}

it.effect('streams every cursor, keeps a visitor through a second tab and drops it with the last one', () =>
	Effect.gen(function* () {
		const presence = Context.get(yield* Layer.build(Presence.layer), Presence)
		const seen = yield* SubscriptionRef.make<PortfolioVisitors>([])
		function watch(id: string) {
			return pipe(
				presence.join({color: 'oklch(0.7 0.2 120)', id, name: id}),
				Stream.runForEach(visitors => SubscriptionRef.set(seen, visitors)),
				Effect.forkScoped
			)
		}
		function until(predicate: (visitors: PortfolioVisitors) => boolean) {
			return pipe(
				SubscriptionRef.changes(seen),
				Stream.filter(predicate),
				Stream.runHead,
				Effect.flatMap(Effect.fromOption)
			)
		}

		const observer = yield* watch('observer')
		const firstTab = yield* watch('guest')
		assert.deepStrictEqual(idsOf(yield* until(visitors => Array.length(visitors) === 4)), [
			'guest',
			'observer',
			'server-alpha',
			'server-beta'
		])

		yield* presence.move({color: 'oklch(0.7 0.2 120)', id: 'guest', x: 0.2, y: 0.3})
		yield* until(guestAt(0.2, 0.3))

		const secondTab = yield* watch('guest')
		yield* until(guestAt(0.5, 0.5))
		yield* Fiber.interrupt(firstTab)
		yield* presence.move({color: 'oklch(0.7 0.2 120)', id: 'guest', x: 0.7, y: 0.7})
		yield* until(guestAt(0.7, 0.7))

		yield* Fiber.interrupt(secondTab)
		assert.deepStrictEqual(idsOf(yield* until(visitors => !Array.some(visitors, visitor => visitor.id === 'guest'))), [
			'observer',
			'server-alpha',
			'server-beta'
		])
		yield* Fiber.interrupt(observer)
	})
)
