import {assert, it} from '@effect/vitest'

import {Array, Context, Effect, Fiber, Layer, Order, Schema, Stream, SubscriptionRef, pipe} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {PortfolioScene, PortfolioVisitors} from '#services/presence/schema.ts'
import {Presence} from '#services/presence/service.ts'

function guestAt(x: number, y: number) {
	return (scene: PortfolioScene) =>
		Array.some(scene.visitors, visitor => visitor.id === 'guest' && visitor.x === x && visitor.y === y)
}

function idsOf(visitors: PortfolioVisitors) {
	return Array.sort(
		Array.map(visitors, visitor => visitor.id),
		Order.String
	)
}

it.effect(
	'rejects guest requests impersonating server bots and keeps bots out of the visitor list',
	Effect.fnUntraced(function* () {
		for (const entry of RpcContracts.requests) {
			const request = entry[1]
			for (const id of ['server-alpha', 'server-beta', 'server-future']) {
				assert.isTrue(
					(yield* Effect.exit(
						Schema.decodeEffect(request.payloadSchema)({color: '#da702c', id, name: 'Guest', x: 0, y: 0})
					))._tag === 'Failure'
				)
			}
			yield* Schema.decodeEffect(request.payloadSchema)({color: '#da702c', id: 'v-42', name: 'Guest', x: 0, y: 0})
		}
	})
)

it.effect(
	'streams every cursor, counts only visitor tabs, keeps a visitor through a second tab and drops it with the last one',
	Effect.fnUntraced(function* () {
		const presence = Context.get(yield* Layer.build(Presence.layer), Presence)
		const seen = yield* SubscriptionRef.make<PortfolioScene>({bots: [], visitors: []})
		function watch(id: string) {
			return pipe(
				presence.join({color: '#da702c', id, name: id}),
				Stream.runForEach(scene => SubscriptionRef.set(seen, scene)),
				Effect.forkScoped
			)
		}
		function until(predicate: (scene: PortfolioScene) => boolean) {
			return pipe(
				SubscriptionRef.changes(seen),
				Stream.filter(predicate),
				Stream.runHead,
				Effect.flatMap(Effect.fromOption)
			)
		}

		const observer = yield* watch('observer')
		const firstTab = yield* watch('guest')
		const scene = yield* until(first => Array.length(first.visitors) === 2 && Array.length(first.bots) === 2)
		assert.deepStrictEqual(idsOf(scene.visitors), ['guest', 'observer'])
		assert.deepStrictEqual(idsOf(scene.bots), ['server-alpha', 'server-beta'])

		yield* presence.move({color: '#da702c', id: 'guest', x: 0.2, y: 0.3})
		yield* until(guestAt(0.2, 0.3))

		const secondTab = yield* watch('guest')
		yield* until(guestAt(0.5, 0.5))
		yield* Fiber.interrupt(firstTab)
		yield* presence.move({color: '#da702c', id: 'guest', x: 0.7, y: 0.7})
		yield* until(guestAt(0.7, 0.7))

		yield* Fiber.interrupt(secondTab)
		const after = yield* until(next => !Array.some(next.visitors, visitor => visitor.id === 'guest'))
		assert.deepStrictEqual(idsOf(after.visitors), ['observer'])
		assert.deepStrictEqual(idsOf(after.bots), ['server-alpha', 'server-beta'])
		yield* Fiber.interrupt(observer)
	})
)
