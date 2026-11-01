import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	ConfigProvider,
	Context,
	Effect,
	Exit,
	Fiber,
	Layer,
	MutableList,
	Option,
	Random,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {KeyValueStore} from 'effect/persistence'
import {TestClock} from 'effect/testing'

import {Core} from '#services/core/service.ts'
import {makeSim, SIMULATION} from '#services/game/lib/sim.ts'
import {
	ActivityPage,
	Entry,
	Frame,
	GameError,
	HistoryIndex,
	HistoryPage,
	Journal,
	RunState,
	Saved
} from '#services/game/schema.ts'
import type {LocalDecision} from '#services/game/schema.ts'
import {Game} from '#services/game/service.ts'

it.layer(Layer.merge(KeyValueStore.layerMemory, ConfigProvider.layer(ConfigProvider.fromUnknown({}))))(test => {
	test.effect(
		'keeps applied Core decisions when a later unfinished decision is paused, resumed and restored',
		Effect.fnUntraced(function* () {
			const kv = yield* KeyValueStore.KeyValueStore
			yield* kv.clear
			const calls = MutableList.make<number>()
			const strategy = Layer.succeed(
				Core,
				Core.of({
					choose: () => Effect.never,
					decide: Effect.fnUntraced(function* (_seed: number, team: number) {
						if (Array.contains(MutableList.toArray(calls), team)) return yield* Effect.never
						MutableList.append(calls, team)
						return {
							commands: [{_tag: 'Catalog' as const, section: 'units' as const}],
							invalid: [],
							text: 'A completed decision.'
						}
					}),
					recall: () => Effect.succeed(''),
					usage: Effect.succeed({groups: {}})
				})
			)
			const layer = pipe(
				Game.layer,
				Layer.provide(strategy),
				Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({SIGNAL_LOCAL_DECISIONS_PER_SECOND: '0'})))
			)
			const entries = KeyValueStore.toSchemaStore(kv, Entry)
			const completed = yield* Effect.scoped(
				Effect.gen(function* () {
					const game = Context.get(yield* Layer.build(layer), Game)
					yield* game.control(true)
					yield* Effect.repeat(TestClock.adjust('1 second'), {times: 60})
					const before = Option.getOrThrow(yield* entries.get('thread/0/000000002'))
					assert.strictEqual(before.status, 'done')
					yield* game.control(false)
					assert.deepStrictEqual(Option.getOrThrow(yield* entries.get('thread/0/000000002')), before)
					const cancelled = Option.getOrThrow(yield* entries.get('thread/0/000000003'))
					assert.include(cancelled.text, 'unfinished decision cancelled')
					assert.strictEqual(cancelled.observed, 1200)
					yield* game.control(true)
					yield* TestClock.adjust('200 millis')
					yield* game.control(false)
					return before
				})
			)
			const restored = Context.get(yield* Layer.build(layer), Game)
			assert.deepStrictEqual(
				Array.findFirst(yield* restored.thread(0, Option.some(4)), entry => entry.round === 2),
				Option.some(completed)
			)
			assert.strictEqual(Option.getOrThrow(yield* entries.get('thread/0/000000003')).status, 'failed')
		})
	)

	test.effect(
		'preserves the earlier replay anchor when a paused world is restarted mid-round',
		Effect.fnUntraced(function* () {
			const kv = yield* KeyValueStore.KeyValueStore
			yield* kv.clear
			const layer = pipe(
				Game.layer,
				Layer.provide(
					Layer.succeed(
						Core,
						Core.of({
							choose: () => Effect.never,
							decide: () => Effect.never,
							recall: () => Effect.succeed(''),
							usage: Effect.succeed({groups: {}})
						})
					)
				),
				Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({SIGNAL_LOCAL_DECISIONS_PER_SECOND: '0'})))
			)
			yield* Effect.scoped(
				Effect.gen(function* () {
					const game = Context.get(yield* Layer.build(layer), Game)
					yield* game.control(true)
					yield* TestClock.adjust('200 millis')
					yield* game.control(false)
				})
			)
			const worlds = KeyValueStore.toSchemaStore(kv, Saved)
			assert.isAbove(Option.getOrThrow(yield* worlds.get('world')).tick, 0)
			const anchor = Option.getOrThrow(yield* worlds.get(`checkpoint/${SIMULATION}/000000000`))
			assert.strictEqual(anchor.tick, 0)
			const game = Context.get(yield* Layer.build(layer), Game)
			yield* game.control(true)
			yield* game.control(false)
			assert.deepStrictEqual(Option.getOrThrow(yield* worlds.get(`checkpoint/${SIMULATION}/000000000`)), anchor)
			assert.strictEqual(Option.getOrThrow(yield* Stream.runHead(game.replay(0, 0))).tick, 0)
		})
	)

	test.effect(
		'runs and pauses from controls without replay changing the world or catching up paused time',
		Effect.fnUntraced(function* () {
			const kv = yield* KeyValueStore.KeyValueStore
			yield* kv.clear
			const calls = MutableList.make<number>()
			const cancelled = MutableList.make<number>()
			const game = Context.get(
				yield* Layer.build(
					pipe(
						Game.layer,
						Layer.provide(
							Layer.succeed(
								Core,
								Core.of({
									choose: Effect.fnUntraced(function* (seed: number, request: LocalDecision) {
										MutableList.append(calls, request.actor)
										return yield* pipe(
											Effect.never,
											Effect.ensuring(Effect.sync(() => MutableList.append(cancelled, seed)))
										)
									}),
									decide: () => Effect.succeed({commands: [], invalid: [], text: ''}),
									recall: () => Effect.succeed(''),
									usage: Effect.succeed({groups: {}})
								})
							)
						)
					)
				),
				Game
			)
			const states = MutableList.make<boolean>()
			const status = yield* Effect.forkScoped(
				Stream.runForEach(game.status, state =>
					pipe(
						Schema.encodeEffect(Schema.toCodecJson(RunState))(state),
						Effect.andThen(Effect.sync(() => MutableList.append(states, state.running)))
					)
				)
			)
			yield* TestClock.adjust('100 millis')
			assert.strictEqual((yield* game.control(true)).running, true)
			assert.strictEqual((yield* game.control(true)).running, true)
			yield* Effect.repeat(TestClock.adjust('1 second'), {times: 2})
			assert.isAbove(calls.length, 0)
			assert.strictEqual((yield* game.control(false)).running, false)
			const stopped = Option.getOrThrow(yield* Stream.runHead(game.join))
			const beforePause = MutableList.toArray(calls)
			assert.strictEqual(cancelled.length, beforePause.length)
			assert.strictEqual(
				Option.getOrThrow(yield* KeyValueStore.toSchemaStore(kv, Saved).get('world')).tick,
				stopped.tick
			)
			yield* TestClock.adjust('1 hour')
			assert.strictEqual(Option.getOrThrow(yield* Stream.runHead(game.join)).tick, stopped.tick)
			assert.deepStrictEqual(MutableList.toArray(calls), beforePause)
			assert.strictEqual(Option.getOrThrow(yield* Stream.runHead(game.replay(0, 0))).tick, 0)
			assert.strictEqual((yield* game.control(false)).running, false)
			assert.strictEqual((yield* game.control(true)).running, true)
			yield* TestClock.adjust('200 millis')
			const resumed = Option.getOrThrow(yield* Stream.runHead(game.join))
			assert.isAbove(resumed.tick, stopped.tick)
			assert.isBelow(resumed.tick - stopped.tick, 10)
			assert.strictEqual((yield* game.control(false)).running, false)
			yield* TestClock.adjust('100 millis')
			yield* Fiber.interrupt(status)
			assert.deepStrictEqual(MutableList.toArray(states), [false, true, false, true, false])
		})
	)

	test.effect(
		'refuses frontend starts after a failed initial save without inference or overwriting the failure',
		Effect.fnUntraced(function* () {
			const kv = yield* KeyValueStore.KeyValueStore
			yield* kv.clear
			const calls = MutableList.make<number>()
			const game = Context.get(
				yield* Layer.build(
					pipe(
						Game.layer,
						Layer.provide(
							Layer.succeed(
								Core,
								Core.of({
									choose: () => Effect.die('No inference before the initial save'),
									decide: seed =>
										Effect.sync(() => {
											MutableList.append(calls, seed)
											return {commands: [], invalid: [], text: ''}
										}),
									recall: () => Effect.succeed(''),
									usage: Effect.succeed({groups: {}})
								})
							)
						),
						Layer.provide(
							Layer.succeed(
								KeyValueStore.KeyValueStore,
								KeyValueStore.make({
									...kv,
									set: (key, value) => {
										if (key === 'world') {
											return Effect.fail(
												new KeyValueStore.KeyValueStoreError({key, message: 'Disk unavailable', method: 'set'})
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
			assert.isTrue(Exit.hasFails(yield* Effect.exit(game.control(true))))
			assert.isTrue(Exit.hasFails(yield* Effect.exit(game.control(true))))
			yield* TestClock.adjust('1 hour')
			const state = Option.getOrThrow(yield* Stream.runHead(game.status))
			assert.strictEqual(state.running, false)
			assert.include(state.problem ?? '', 'world could not be saved')
			assert.strictEqual(calls.length, 0)
			assert.deepStrictEqual(yield* kv.keys, [])
		})
	)

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
					recall: () => Effect.succeed(''),
					usage: Effect.succeed({groups: {}})
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
			const stoppedFrames = MutableList.make<number>()
			const connection = yield* Effect.forkScoped(
				Stream.runForEach(game.join, stopped => Effect.sync(() => MutableList.append(stoppedFrames, stopped.tick)))
			)
			yield* Effect.repeat(TestClock.adjust('100 millis'), {times: 3})
			yield* Fiber.interrupt(connection)
			assert.deepStrictEqual(MutableList.toArray(stoppedFrames), [0])
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
									recall: () => Effect.succeed(''),
									usage: Effect.succeed({groups: {}})
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

	test.effect(
		'reindexes archived receipts and pages history without duplicating a restored pending tail',
		Effect.fnUntraced(function* () {
			const kv = yield* KeyValueStore.KeyValueStore
			yield* kv.clear
			const saved = yield* (yield* makeSim(Option.none(), 42)).snapshot
			const rows = Array.map(
				Array.range(0, 120),
				sequence =>
					({
						actor: 2,
						actorKind: 'worker',
						...Boolean.match(sequence === 1, {
							onFalse: () => ({}),
							onTrue: () => ({
								context: 'Archived request from the previous release.',
								tokens: {cost: 0.001, input: 23, output: 4}
							})
						}),
						id: 1000 + sequence,
						kind: 'action',
						text: `Gathered stone ${sequence}.`,
						tick: sequence * 20,
						x: 10,
						z: 10
					}) satisfies HistoryPage[number]
			)
			yield* KeyValueStore.toSchemaStore(kv, Saved).set('world', {
				...saved,
				life: {...Option.getOrThrow(Option.fromUndefinedOr(saved.life)), sequence: 1120},
				pendingExperiences: Array.takeRight(rows, 11),
				tick: 2420
			})
			for (const chunk of Array.map(Array.chunksOf(rows, 100), (entries, page) => ({entries, page}))) {
				yield* KeyValueStore.toSchemaStore(kv, HistoryPage).set(
					`history/2/${String.padStart(9, '0')(`${chunk.page}`)}`,
					chunk.entries
				)
			}
			const references = Array.filter(
				Array.map(rows, (entry, index) => ({
					actor: entry.actor,
					id: entry.id,
					page: Math.floor(index / 100),
					tick: entry.tick
				})),
				entry => entry.id !== 1001
			)
			for (const chunk of Array.map(Array.chunksOf(references, 100), (entries, page) => ({entries, page}))) {
				yield* KeyValueStore.toSchemaStore(kv, ActivityPage).set(
					`activity/${String.padStart(9, '0')(`${chunk.page}`)}`,
					chunk.entries
				)
			}
			yield* KeyValueStore.toSchemaStore(kv, HistoryIndex).set('history/index', {
				'@activity': references.length,
				'@rules': SIMULATION,
				'@through': 1120,
				'@tick': 2420,
				'2': rows.length
			})
			const game = Context.get(
				yield* Layer.build(
					pipe(
						Game.layer,
						Layer.provide(
							Layer.succeed(
								Core,
								Core.of({
									choose: () => Effect.fail(GameError.make({message: 'No inference in history queries.'})),
									decide: () => Effect.fail(GameError.make({message: 'No inference in history queries.'})),
									recall: () => Effect.succeed(''),
									usage: Effect.succeed({groups: {}})
								})
							)
						)
					)
				),
				Game
			)
			for (const actor of [2, 'all'] as const) {
				assert.strictEqual(
					Option.getOrThrow(Array.findFirst(yield* game.history(actor, Option.some(1002)), entry => entry.id === 1001))
						.tokens?.input,
					23
				)
				assert.deepStrictEqual(
					Array.map(yield* game.history(actor, Option.none()), entry => entry.id),
					Array.range(1021, 1120)
				)
				assert.deepStrictEqual(
					Array.map(yield* game.history(actor, Option.some(1021)), entry => entry.id),
					Array.range(1000, 1020)
				)
				assert.deepStrictEqual(
					Array.map(yield* game.history(actor, Option.none(), 1000), entry => entry.id),
					Array.range(1000, 1050)
				)
			}
		})
	)

	test.effect(
		'recovers committed natural simulation progress beyond the periodic snapshot without inference',
		Effect.fnUntraced(function* () {
			const kv = yield* KeyValueStore.KeyValueStore
			yield* kv.clear
			const calls = MutableList.make<number>()
			const deny = Effect.fnUntraced(function* (seed: number) {
				MutableList.append(calls, seed)
				return yield* GameError.make({message: 'Inference is forbidden in recovery.'})
			})
			const strategy = pipe(
				Layer.succeed(
					Core,
					Core.of({choose: deny, decide: deny, recall: () => Effect.succeed(''), usage: Effect.succeed({groups: {}})})
				),
				Layer.merge(Layer.succeed(Random.Random, {nextDoubleUnsafe: () => 42 / 2_000_000_001, nextIntUnsafe: () => 42}))
			)
			const live = yield* Effect.scoped(
				Effect.gen(function* () {
					const game = Context.get(
						yield* Layer.build(
							pipe(
								Game.layer,
								Layer.provide(strategy),
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
											set: Effect.fnUntraced(function* (key: string, value: string | Uint8Array) {
												if (key === 'world' && (yield* kv.has(key))) {
													return yield* new KeyValueStore.KeyValueStoreError({
														key,
														message: 'Simulated loss of the final snapshot.',
														method: 'set'
													})
												}
												yield* kv.set(key, value)
											})
										})
									)
								)
							)
						),
						Game
					)
					assert.strictEqual(Option.getOrThrow(yield* KeyValueStore.toSchemaStore(kv, Saved).get('world')).tick, 0)
					yield* Effect.repeat(TestClock.adjust('1 second'), {times: 1})
					return {
						frame: Option.getOrThrow(yield* Stream.runHead(game.join)),
						history: yield* game.history(2, Option.none())
					}
				})
			)
			assert.strictEqual(live.frame.paused, false)
			assert.strictEqual(live.frame.tick, 40)
			assert.strictEqual(Option.getOrThrow(yield* KeyValueStore.toSchemaStore(kv, Saved).get('world')).tick, 0)
			assert.strictEqual(
				Option.getOrThrow(yield* KeyValueStore.toSchemaStore(kv, HistoryIndex).get('history/index'))['@tick'],
				40
			)
			const recovered = Context.get(yield* Layer.build(pipe(Game.layer, Layer.provide(strategy))), Game)
			const frame = Option.getOrThrow(yield* Stream.runHead(recovered.join))
			assert.strictEqual(frame.tick, live.frame.tick)
			assert.deepStrictEqual(frame.units, live.frame.units)
			assert.deepStrictEqual(yield* recovered.history(2, Option.none()), live.history)
			assert.strictEqual(calls.length, 0)
		})
	)

	test.effect(
		'keeps the observation timestamp when a Core answer is applied at a later boundary',
		Effect.fnUntraced(function* () {
			yield* (yield* KeyValueStore.KeyValueStore).clear
			const game = Context.get(
				yield* Layer.build(
					pipe(
						Game.layer,
						Layer.provide(
							Layer.succeed(
								Core,
								Core.of({
									choose: () => Effect.fail(GameError.make({message: 'No local inference in this fixture.'})),
									decide: () => Effect.succeed({commands: [], invalid: [], text: 'A considered response.'}),
									recall: () => Effect.succeed(''),
									usage: Effect.succeed({groups: {}})
								})
							)
						),
						Layer.provide(
							ConfigProvider.layer(
								ConfigProvider.fromUnknown({SIGNAL_LOCAL_DECISIONS_PER_SECOND: '0', SIGNAL_RUN: 'running'})
							)
						)
					)
				),
				Game
			)
			yield* Effect.repeat(TestClock.adjust('1 second'), {times: 59})
			const entry = Option.getOrThrow(Array.last(yield* game.thread(0, Option.none())))
			assert.strictEqual(entry.status, 'done')
			assert.strictEqual(entry.observed, 600)
			assert.strictEqual(entry.tick, 1200)
		})
	)
})
