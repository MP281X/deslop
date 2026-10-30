import {assert, it} from '@effect/vitest'

import {
	Array,
	ConfigProvider,
	Context,
	Effect,
	Exit,
	Fiber,
	Layer,
	MutableList,
	Option,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {KeyValueStore} from 'effect/persistence'
import {TestClock} from 'effect/testing'

import {Core} from '#services/core/service.ts'
import {makeSim, SIMULATION} from '#services/game/lib/sim.ts'
import {Frame, GameError, Journal, Saved} from '#services/game/schema.ts'
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
			assert.isTrue(Schema.is(Frame)(frame))
			yield* Schema.encodeEffect(Schema.toCodecJson(Frame))(frame)
			assert.strictEqual(frame.tick, 0)
			assert.strictEqual(calls.length, 0)
			assert.deepStrictEqual(yield* kv.keys, [])
			assert.isAbove((yield* game.history(2, Option.none())).length, 0)
			yield* kv.set('world', 'corrupt')
			assert.isTrue(Exit.hasFails(yield* Effect.exit(Layer.build(pipe(Game.layer, Layer.provide(strategy))))))
			assert.strictEqual(yield* kv.get('world'), 'corrupt')
			assert.strictEqual(calls.length, 0)
			yield* kv.clear
			const previous = yield* (yield* makeSim(Option.none(), 42)).snapshot
			const saves = KeyValueStore.toSchemaStore(kv, Saved)
			yield* saves.set('world', previous)
			yield* saves.set(`checkpoint/${SIMULATION}/000000000`, previous)
			yield* KeyValueStore.toSchemaStore(kv, Journal).set(`local/${SIMULATION}/000000020`, {
				applied: [],
				locals: [{actor: 2, choice: 'rest', tick: 20}],
				marks: [],
				round: 0
			})
			const recovered = Context.get(yield* Layer.build(pipe(Game.layer, Layer.provide(strategy))), Game)
			assert.isTrue(
				Array.some(
					yield* recovered.history(2, Option.none()),
					entry => entry.tick === 20 && String.includes('Chose rest:')(entry.text)
				)
			)
			assert.strictEqual(Option.getOrThrow(yield* saves.get('world')).tick, 0)
			assert.strictEqual(calls.length, 0)
			const historical = yield* Effect.forkScoped(Stream.runHead(recovered.replay(0, 0)))
			yield* TestClock.adjust('100 millis')
			assert.strictEqual(Option.getOrThrow(yield* Fiber.join(historical)).tick, 0)
		})
	)

	test.effect(
		'stops clock and inference when a failed provider response cannot be archived',
		Effect.fnUntraced(function* () {
			const kv = yield* KeyValueStore.KeyValueStore
			yield* kv.clear
			yield* KeyValueStore.toSchemaStore(kv, Saved).set('world', yield* (yield* makeSim(Option.none(), 42)).snapshot)
			const calls = MutableList.make<number>()
			const game = Context.get(
				yield* Layer.build(
					pipe(
						Game.layer,
						Layer.provide(
							Layer.succeed(
								Core,
								Core.of({
									choose: () => Effect.fail(GameError.make({message: 'Local requests disabled in this fixture.'})),
									decide: Effect.fnUntraced(function* (seed: number) {
										MutableList.append(calls, seed)
										return yield* GameError.make({message: 'Offline provider failure.'})
									}),
									recall: () => Effect.succeed('')
								})
							)
						),
						Layer.provide(
							ConfigProvider.layer(
								ConfigProvider.fromUnknown({SIGNAL_LOCAL_DECISIONS_PER_SECOND: '0', SIGNAL_RUN: 'running'})
							)
						),
						Layer.provide(
							Layer.succeed(
								KeyValueStore.KeyValueStore,
								KeyValueStore.make({
									...kv,
									set: (key, value) => {
										if (String.startsWith('thread/')(key)) {
											return Effect.fail(
												new KeyValueStore.KeyValueStoreError({key, message: 'Offline archive failure.', method: 'set'})
											)
										}
										return kv.set(key, value)
									}
								})
							)
						)
					)
				),
				Game
			)
			yield* Effect.repeat(TestClock.adjust('1 second'), {times: 30})
			const frame = Option.getOrThrow(yield* Stream.runHead(game.join))
			assert.strictEqual(frame.paused, true)
			assert.include(frame.problem ?? '', 'conversation could not be archived')
			assert.isAbove(calls.length, 0)
			yield* TestClock.adjust('1 minute')
			assert.strictEqual(Option.getOrThrow(yield* Stream.runHead(game.join)).tick, frame.tick)
			assert.strictEqual(calls.length, 3)
		})
	)
})
