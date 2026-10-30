import {assert, it} from '@effect/vitest'

import {ConfigProvider, Context, Effect, Exit, Fiber, Layer, MutableList, Option, Stream, pipe} from 'effect'

import {KeyValueStore} from 'effect/persistence'
import {TestClock} from 'effect/testing'

import {Core} from '#services/core/service.ts'
import {Game} from '#services/game/service.ts'

it.layer(Layer.merge(KeyValueStore.layerMemory, ConfigProvider.layer(ConfigProvider.fromUnknown({}))))(test => {
	test.effect(
		'starts stopped without model calls or writes and refuses to replace an unreadable world',
		Effect.fnUntraced(function* () {
			const calls = MutableList.make<number>()
			const kv = yield* KeyValueStore.KeyValueStore
			const strategy = Layer.succeed(
				Core,
				Core.of({
					choose: (seed, request) =>
						Effect.sync(() => {
							MutableList.append(calls, seed)
							return {actor: request.actor, choice: 'continue', input: 0, output: 0, tick: request.tick}
						}),
					decide: seed =>
						Effect.sync(() => {
							MutableList.append(calls, seed)
							return {commands: [], invalid: [], text: ''}
						}),
					recall: () => Effect.succeed('')
				})
			)
			const game = Context.get(yield* Layer.build(pipe(Game.layer, Layer.provide(strategy))), Game)
			const waiting = yield* Effect.forkScoped(Stream.runHead(game.join))
			yield* TestClock.adjust('1 hour')
			const frame = Option.getOrThrow(yield* Fiber.join(waiting))
			assert.strictEqual(frame.paused, true)
			assert.strictEqual(frame.tick, 0)
			assert.strictEqual(calls.length, 0)
			assert.deepStrictEqual(yield* kv.keys, [])
			assert.isAbove((yield* game.history(2, Option.none())).length, 0)
			yield* kv.set('world', 'corrupt')
			assert.isTrue(Exit.hasFails(yield* Effect.exit(Layer.build(pipe(Game.layer, Layer.provide(strategy))))))
			assert.strictEqual(yield* kv.get('world'), 'corrupt')
			assert.strictEqual(calls.length, 0)
		})
	)
})
