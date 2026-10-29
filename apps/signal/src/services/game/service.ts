import {
	Array,
	Clock,
	Config,
	Context,
	Effect,
	Exit,
	Fiber,
	Layer,
	MutableHashMap,
	MutableRef,
	Number,
	Option,
	Path,
	Random,
	Schedule,
	Stream,
	String,
	pipe
} from 'effect'

import {KeyValueStore} from 'effect/persistence'

import {layerKeyValueStore} from '@deslop/runtime/server'

import type {Decision} from '#services/core/schema.ts'
import {Core} from '#services/core/service.ts'
import {makeSim} from '#services/game/lib/sim.ts'
import {FRAME_HZ, ROUND, TICK, TICK_HZ} from '#services/game/lib/utils.ts'
import type {Command, Frame} from '#services/game/schema.ts'
import {Entry, GameError, Journal, Saved, Timeline} from '#services/game/schema.ts'
import {GENERATOR} from '#services/world/lib/utils.ts'

// How many rounds of a thread one page holds.
const PAGE = 20
// A replay starts from the latest checkpoint before it, one every few rounds.
const CHECKPOINT = 4

function padded(round: number) {
	return String.padStart(9, '0')(`${round}`)
}

function keyOf(team: number, round: number) {
	return `thread/${team}/${padded(round)}`
}

export class Game extends Context.Service<
	Game,
	{
		readonly join: Stream.Stream<Frame>
		// The world as it was from a tick on, played at a multiple of real time (0 holds still), up to the live tick.
		readonly replay: (from: number, speed: number) => Stream.Stream<Frame, GameError>
		// A team's thread, newest last: the rounds before `before`, or the latest.
		readonly thread: (team: number, before: Option.Option<number>) => Effect.Effect<Entry[], GameError>
		readonly timeline: Effect.Effect<Timeline>
	}
>()('@deslop/signal/services/game/service/Game') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const path = yield* Path.Path
			const directory = yield* pipe(
				Config.String('SIGNAL_DATA'),
				Config.withDefault(path.join(yield* Config.String('HOME'), '.deslop', 'signal'))
			)
			const kv = Context.get(yield* Layer.build(layerKeyValueStore(directory)), KeyValueStore.KeyValueStore)
			const worlds = KeyValueStore.toSchemaStore(kv, Saved)
			const entries = KeyValueStore.toSchemaStore(kv, Entry)
			const journals = KeyValueStore.toSchemaStore(kv, Journal)
			const timelines = KeyValueStore.toSchemaStore(kv, Timeline)
			// A save from an older world model does not decode or restore, and the world starts over with nothing of the old one kept.
			const fresh = yield* Random.nextIntBetween(0, 2_000_000_000)
			const restored = yield* pipe(
				worlds.get('world'),
				Effect.flatMap(saved =>
					Option.match(
						Option.filter(saved, previous => previous.generator === GENERATOR),
						{onNone: () => Effect.succeedNone, onSome: previous => Effect.asSome(makeSim(Option.some(previous), fresh))}
					)
				),
				Effect.catch(cause =>
					Effect.as(Effect.logWarning('Signal starts a fresh world: the saved one is unreadable', cause), Option.none())
				)
			)
			if (Option.isNone(restored)) {
				yield* Effect.ignore(kv.clear, {log: 'Warn', message: 'Signal could not clear the old world'})
			}
			const sim = yield* Option.match(restored, {onNone: () => makeSim(Option.none(), fresh), onSome: Effect.succeed})
			const core = yield* Core
			const scope = yield* Effect.scope
			// Each team's decision under way, for the round it was asked in; and the entry its round opened with.
			const thinking = MutableHashMap.empty<number, {entry: Entry; fiber: Fiber.Fiber<Decision, GameError>}>()
			const recent = MutableHashMap.empty<number, Entry[]>()
			const started = MutableRef.make({at: yield* Clock.currentTimeMillis, tick: sim.tick()})
			const timeline = MutableRef.make(
				Option.getOrElse(yield* Effect.orElseSucceed(timelines.get('timeline'), () => Option.none()), () => ({
					live: sim.tick(),
					marks: [],
					start: sim.tick()
				}))
			)

			const record = Effect.fn('Game.record')(function* (entry: Entry) {
				MutableHashMap.set(
					recent,
					entry.team,
					Array.takeRight([...Option.getOrElse(MutableHashMap.get(recent, entry.team), () => []), entry], 60)
				)
				yield* Effect.ignore(entries.set(keyOf(entry.team, entry.round), entry), {
					log: 'Warn',
					message: 'Signal could not keep a thread entry'
				})
			})

			const save = pipe(
				Effect.flatMap(sim.snapshot, saved => worlds.set('world', saved)),
				Effect.catch(cause => Effect.logError('Signal could not save the world', cause))
			)

			// The world as a boundary leaves it, for replays to start from; the one six hours (720 rounds) older goes unless it is one of every forty kept for good.
			const checkpoint = Effect.fn('Game.checkpoint')(
				function* (round: number) {
					yield* worlds.set(`checkpoint/${padded(round)}`, yield* sim.snapshot)
					const old = round - 720
					if (old > 0 && old % 40 !== 0) yield* kv.remove(`checkpoint/${padded(old)}`)
				},
				Effect.catch(cause => Effect.logError('Signal could not keep a checkpoint', cause))
			)

			// A team's decision at the first boundary after it came, within three rounds of being asked: a team still thinking keeps thinking and is not asked again; past the third round its decision is recorded as late (a failed one was recorded when it failed). The thread keeps it under the round it applied at, so a replay never shows a decision before it was made. What applied goes back for the journal.
			const settle = Effect.fnUntraced(function* (
				team: number,
				round: number,
				pending: {entry: Entry; fiber: Fiber.Fiber<Decision, GameError>}
			) {
				const exit = pending.fiber.pollUnsafe()
				if (exit === undefined && round - pending.entry.round < 3) return Array.empty<Command>()
				MutableHashMap.remove(thinking, team)
				yield* Fiber.interrupt(pending.fiber)
				if (exit === undefined) {
					sim.setStatus(team, 'failed')
					yield* record({
						...pending.entry,
						round,
						status: 'late',
						text: 'No answer within three rounds.',
						tick: sim.tick()
					})
					return Array.empty<Command>()
				}
				if (!Exit.isSuccess(exit)) return Array.empty<Command>()
				yield* record({
					...pending.entry,
					commands: sim.apply(team, [...exit.value.commands]),
					round,
					tick: sim.tick(),
					...Option.match(Option.fromUndefinedOr(exit.value.reasoning), {
						onNone: () => ({}),
						onSome: reasoning => ({reasoning})
					}),
					status: 'done',
					text: Array.join(
						[exit.value.text, ...Array.map(exit.value.invalid, call => `Unreadable tool call: ${call}`)],
						'\n'
					),
					...Option.match(Option.fromUndefinedOr(exit.value.tokens), {onNone: () => ({}), onSome: tokens => ({tokens})})
				})
				return exit.value.commands
			})

			// A round's boundary: each team's decision from the round before applies, in an order that turns each round, and goes in the journal with the round's marks; then every team reads the world as it now is and starts on its next decision.
			const boundary = Effect.fn('Game.boundary')(function* (round: number) {
				const teams = sim.teams()
				const applied = yield* Effect.forEach(
					[...Array.drop(teams, round % teams.length), ...Array.take(teams, round % teams.length)],
					team =>
						Option.match(MutableHashMap.get(thinking, team), {
							onNone: () => Effect.succeed({commands: Array.empty<Command>(), team}),
							onSome: pending => Effect.map(settle(team, round, pending), commands => ({commands, team}))
						}),
					{concurrency: 1}
				)
				const marks = sim.marks()
				MutableRef.update(timeline, before => ({...before, live: sim.tick(), marks: [...before.marks, ...marks]}))
				yield* Effect.ignore(journals.set(`journal/${padded(round)}`, {applied, marks, round}), {
					log: 'Warn',
					message: 'Signal could not keep a journal entry'
				})
				yield* Effect.ignore(timelines.set('timeline', MutableRef.get(timeline)), {
					log: 'Warn',
					message: 'Signal could not keep the timeline'
				})
				if (round % CHECKPOINT === 0) yield* checkpoint(round)
				for (const team of Array.filter(teams, id => !MutableHashMap.has(thinking, id))) {
					const seen = sim.observe(team)
					const entry: Entry = {
						commands: [],
						notices: seen.notices,
						observation: seen.text,
						round,
						status: 'failed',
						team,
						text: '',
						tick: sim.tick()
					}
					sim.setStatus(team, 'thinking')
					// The call lives no longer than the service; a failure is kept under the boundary it would have applied at.
					const fiber = yield* Effect.forkIn(
						pipe(
							core.decide(
								team,
								Array.join([...Array.map(seen.notices, notice => `Notice: ${notice}`), seen.text], '\n')
							),
							Effect.tap(() => Effect.sync(() => sim.setStatus(team, 'waiting'))),
							Effect.tapError(error =>
								Effect.andThen(
									Effect.sync(() => sim.setStatus(team, 'failed')),
									Effect.suspend(() =>
										record({
											...entry,
											round: Math.floor(sim.tick() / ROUND) + 1,
											status: 'failed',
											text: error.message,
											tick: sim.tick()
										})
									)
								)
							)
						),
						scope
					)
					MutableHashMap.set(thinking, team, {entry, fiber})
				}
			})

			const tickOnce = Effect.gen(function* () {
				yield* sim.run(1)
				if (sim.tick() % ROUND === 0) yield* boundary(sim.tick() / ROUND)
			})

			// The world keeps time with the wall clock in whole ticks; a server that fell more than two seconds behind skips the rest rather than racing to catch up.
			const advance = Effect.gen(function* () {
				const now = yield* Clock.currentTimeMillis
				const from = MutableRef.get(started)
				const due = from.tick + Math.floor((now - from.at) / (TICK * 1000)) - sim.tick()
				if (due > 40) MutableRef.set(started, {at: now, tick: sim.tick()})
				if (due > 0) {
					yield* Effect.forEach(Array.range(1, Number.min(due, 40)), () => tickOnce, {concurrency: 1, discard: true})
				}
				MutableRef.update(timeline, before => ({...before, live: sim.tick()}))
			})

			// A fresh world keeps its first moment, so the timeline starts there.
			if (sim.tick() === 0) yield* checkpoint(0)
			yield* Effect.forkScoped(Effect.repeat(advance, Schedule.spaced(`${TICK * 1000} millis`)))
			yield* Effect.forkScoped(Effect.repeat(save, Schedule.spaced('15 seconds')))
			yield* Effect.addFinalizer(() => save)

			// The latest checkpoint at or before a round, searching back on the checkpoint rounds.
			const checkpointBefore = Effect.fnUntraced(function* (round: number) {
				for (const at of Array.reverse(Array.range(0, Math.floor(round / CHECKPOINT)))) {
					const found = yield* worlds.get(`checkpoint/${padded(at * CHECKPOINT)}`)
					if (Option.isSome(found)) return found
				}
				return Option.none<Saved>()
			})

			// A replay's own world: the checkpoint before `from`, run on with the journal's commands at each boundary.
			const replayFrom = Effect.fnUntraced(
				function* (from: number) {
					const start = Option.filter(
						yield* checkpointBefore(Math.floor(from / ROUND)),
						found => found.generator === GENERATOR
					)
					if (Option.isNone(start)) {
						return yield* GameError.make({message: 'The replay has no checkpoint that early.'})
					}
					const replayed = yield* makeSim(start, 0)
					const step = Effect.gen(function* () {
						yield* replayed.run(1)
						// Every hundred ticks it yields while it catches up, so the live world keeps time.
						if (replayed.tick() % 100 === 0) yield* Effect.yieldNow
						if (replayed.tick() % ROUND !== 0) return
						for (const entry of Option.match(yield* journals.get(`journal/${padded(replayed.tick() / ROUND)}`), {
							onNone: () => [],
							onSome: found => found.applied
						})) {
							replayed.apply(entry.team, [...entry.commands])
						}
						// The models' notices are not part of the replay.
						for (const team of replayed.teams()) replayed.observe(team)
					})
					// Runs the replay on some ticks; none for a replay held still or caught up.
					function run(ticks: number) {
						return Effect.forEach(
							Array.filter(Array.range(1, ticks), () => ticks > 0),
							() => step,
							{concurrency: 1, discard: true}
						)
					}
					yield* run(from - replayed.tick())
					return {run, sim: replayed}
				},
				Effect.mapError(cause => GameError.make({cause, message: 'The replay could not start.'}))
			)

			return Game.of({
				join: Stream.unwrap(
					Effect.gen(function* () {
						const id = yield* Effect.acquireRelease(
							Effect.sync(() => sim.connect()),
							connection => Effect.sync(() => sim.disconnect(connection))
						)
						return pipe(
							Stream.tick(`${1000 / FRAME_HZ} millis`),
							Stream.mapEffect(() => Effect.map(Clock.currentTimeMillis, now => sim.frame(id, now))),
							Stream.flatMap(frame => Stream.fromIterable(Option.toArray(frame)))
						)
					})
				),
				replay: (from, speed) =>
					Stream.unwrap(
						Effect.gen(function* () {
							const replay = yield* replayFrom(Number.min(from, sim.tick()))
							const id = replay.sim.connect()
							return pipe(
								Stream.tick(`${1000 / FRAME_HZ} millis`),
								Stream.mapEffect(
									Effect.fnUntraced(function* () {
										// Each frame moves the replay on by the speed's share of a second, never past the live world.
										yield* Effect.mapError(
											replay.run(
												Number.min(Number.round((speed * TICK_HZ) / FRAME_HZ, 0), sim.tick() - replay.sim.tick())
											),
											cause => GameError.make({cause, message: 'The replay could not go on.'})
										)
										return Option.map(replay.sim.frame(id, yield* Clock.currentTimeMillis), frame => ({
											...frame,
											live: sim.tick()
										}))
									})
								),
								Stream.flatMap(frame => Stream.fromIterable(Option.toArray(frame)))
							)
						})
					),
				thread: Effect.fn('Game.thread')(
					function* (team: number, before: Option.Option<number>) {
						const last = Option.getOrElse(before, () => Math.floor(sim.tick() / ROUND) + 1)
						const cached = Array.filter(
							Option.getOrElse(MutableHashMap.get(recent, team), () => []),
							entry => entry.round < last
						)
						if (cached.length >= PAGE) return Array.takeRight(cached, PAGE)
						return Array.getSomes(
							yield* Effect.forEach(
								Array.range(Number.max(0, last - PAGE), last - 1),
								round => entries.get(keyOf(team, round)),
								{concurrency: 'unbounded'}
							)
						)
					},
					Effect.mapError(cause => GameError.make({cause, message: 'The thread could not be read.'}))
				),
				timeline: Effect.sync(() => MutableRef.get(timeline))
			})
		})
	)
}
