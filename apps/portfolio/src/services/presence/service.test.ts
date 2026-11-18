import {assert, it} from '@effect/vitest'

import {
	Array,
	Context,
	Deferred,
	Effect,
	Fiber,
	Layer,
	Option,
	Ref,
	Stream,
	String,
	SubscriptionRef,
	pipe
} from 'effect'

import {SecureRandom} from 'effect/crypto'
import {TestClock} from 'effect/testing'

import type {Scene, VisitorId} from './schema.ts'
import {GuestKey, PresenceError} from './schema.ts'
import {Presence} from './service.ts'

const OBSERVER = GuestKey.make('00000000-0000-4000-8000-000000000001')
const GUEST = GuestKey.make('00000000-0000-4000-8000-000000000002')

// One room per test: the room's state never carries from one test to the next.
const room = Effect.map(Layer.build(Layer.provide(Presence.layer, SecureRandom.layerWebCrypto)), services =>
	Context.get(services, Presence)
)

// The room publishes at most once per 50 ms and a change can wait behind one already pulled, so two periods publish it.
const publish = Effect.andThen(TestClock.adjust('50 millis'), TestClock.adjust('50 millis'))

function at(id: VisitorId, x: number, y: number) {
	return (scene: Scene) =>
		Array.some(scene.visitors, visitor => visitor.id === id && visitor.x === x && visitor.y === y)
}

// A tab in the room: its cursor's public id, a wait for the first scene that matches, and how many scenes it has read.
const tab = Effect.fnUntraced(function* (presence: typeof Presence.Service, key: GuestKey, connection: number) {
	const ready = yield* Deferred.make<Scene>()
	const seen = yield* SubscriptionRef.make<Option.Option<Scene>>(Option.none())
	const read = yield* Ref.make(0)
	const fiber = yield* pipe(
		presence.join({color: '#da702c', key, name: `tab-${connection}`}, connection),
		Stream.runForEach(
			Effect.fnUntraced(function* (scene) {
				yield* SubscriptionRef.set(seen, Option.some(scene))
				yield* Ref.update(read, count => count + 1)
				yield* Deferred.succeed(ready, scene)
			})
		),
		Effect.forkScoped
	)
	return {
		fiber,
		own: (yield* Deferred.await(ready)).own,
		read,
		until: Effect.fnUntraced(function* (predicate: (scene: Scene) => boolean) {
			return yield* pipe(
				SubscriptionRef.changes(seen),
				Stream.filter(Option.exists(predicate)),
				Stream.runHead,
				Effect.flatMap(Effect.fromOption),
				Effect.flatMap(Effect.fromOption)
			)
		})
	}
})

it.effect(
	'shares one cursor among the tabs that hold a guest key until the last one leaves',
	Effect.fnUntraced(function* () {
		const presence = yield* room
		const observer = yield* tab(presence, OBSERVER, 0)
		const first = yield* tab(presence, GUEST, 1)
		yield* publish
		const scene = yield* observer.until(next => Array.length(next.visitors) === 2 && Array.length(next.bots) === 2)
		assert.notStrictEqual(first.own, observer.own)
		// The scene names the guest by its public id alone; the key stays with its tabs.
		assert.deepStrictEqual(
			Array.findFirst(scene.visitors, visitor => visitor.id === first.own),
			Option.some({color: '#da702c', id: first.own, name: 'tab-1', x: 0.5, y: 0.5})
		)

		yield* presence.move({x: 0.2, y: 0.3}, 1)
		yield* presence.recolor({color: '#4385be'}, 1)
		yield* publish
		yield* observer.until(
			next =>
				at(first.own, 0.2, 0.3)(next) &&
				Array.some(next.visitors, visitor => visitor.id === first.own && visitor.color === '#4385be')
		)

		const second = yield* tab(presence, GUEST, 2)
		assert.strictEqual(second.own, first.own)
		yield* Fiber.interrupt(first.fiber)
		yield* presence.move({x: 0.7, y: 0.7}, 2)
		yield* publish
		yield* observer.until(at(first.own, 0.7, 0.7))
		assert.instanceOf(yield* Effect.flip(presence.move({x: 0.1, y: 0.1}, 1)), PresenceError)

		yield* Fiber.interrupt(second.fiber)
		yield* publish
		const after = yield* observer.until(next => !Array.some(next.visitors, visitor => visitor.id === first.own))
		assert.deepStrictEqual(
			Array.map(after.visitors, visitor => visitor.id),
			[observer.own]
		)
		assert.strictEqual(Array.length(after.bots), 2)
	})
)

it.effect(
	'gives each socket its own budget per command',
	Effect.fnUntraced(function* () {
		const presence = yield* room
		yield* tab(presence, GUEST, 1)
		assert.instanceOf(yield* Effect.flip(presence.move({x: 0.2, y: 0.2}, 2)), PresenceError)

		yield* presence.move({x: 0.2, y: 0.2}, 1)
		assert.instanceOf(yield* Effect.flip(presence.move({x: 0.3, y: 0.3}, 1)), PresenceError)
		yield* presence.recolor({color: '#4385be'}, 1)
		yield* TestClock.adjust('50 millis')
		yield* presence.move({x: 0.3, y: 0.3}, 1)
		assert.instanceOf(yield* Effect.flip(presence.recolor({color: '#8b7ec8'}, 1)), PresenceError)
		yield* TestClock.adjust('200 millis')
		yield* presence.recolor({color: '#8b7ec8'}, 1)
	})
)

it.effect(
	'publishes at most one scene per 50 ms however often cursors move',
	Effect.fnUntraced(function* () {
		const presence = yield* room
		const observer = yield* tab(presence, OBSERVER, 0)
		yield* Effect.forEach(
			Array.range(1, 5),
			index => tab(presence, GuestKey.make(`00000000-0000-4000-8000-00000000001${index}`), index),
			{concurrency: 1, discard: true}
		)
		const before = yield* Ref.get(observer.read)
		// A second of five cursors each moving 20 times a second: 100 changes besides the wandering bots.
		yield* Effect.forEach(
			Array.range(0, 99),
			tick =>
				Effect.andThen(TestClock.adjust('10 millis'), presence.move({x: (tick + 1) / 100, y: 0.5}, 1 + (tick % 5))),
			{concurrency: 1, discard: true}
		)
		assert.isAtMost((yield* Ref.get(observer.read)) - before, 21)
	})
)

it.effect(
	'admits 128 guests and 256 sockets',
	Effect.fnUntraced(function* () {
		const presence = yield* room
		yield* Effect.forEach(
			Array.range(0, 127),
			index =>
				tab(presence, GuestKey.make(`00000000-0000-4000-8000-${String.padStart(12, '0')(`${index}`)}`), 1000 + index),
			{concurrency: 1, discard: true}
		)
		assert.instanceOf(
			yield* Effect.flip(
				Stream.runHead(
					presence.join(
						{color: '#da702c', key: GuestKey.make('00000000-0000-4000-8000-000000000999'), name: 'Overflow'},
						5000
					)
				)
			),
			PresenceError
		)
		const shared = GuestKey.make('00000000-0000-4000-8000-000000000000')
		yield* Effect.forEach(Array.range(0, 127), index => tab(presence, shared, 2000 + index), {
			concurrency: 1,
			discard: true
		})
		assert.instanceOf(
			yield* Effect.flip(Stream.runHead(presence.join({color: '#da702c', key: shared, name: 'Extra tab'}, 5001))),
			PresenceError
		)
	})
)
