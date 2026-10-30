import {
	Array,
	Boolean,
	Clock,
	Cause,
	Config,
	Context,
	Effect,
	Exit,
	Fiber,
	Layer,
	MutableHashMap,
	MutableList,
	MutableRef,
	Number,
	Option,
	Random,
	Record,
	Schedule,
	Schema,
	Semaphore,
	Stream,
	String,
	pipe
} from 'effect'

import {KeyValueStore} from 'effect/persistence'

import type {Thought, LocalChoice} from '#services/core/schema.ts'
import {Core} from '#services/core/service.ts'
import {makeSim, SIMULATION} from '#services/game/lib/sim.ts'
import {FRAME_HZ, ROUND, TICK, TICK_HZ} from '#services/game/lib/utils.ts'
import type {Experience, Frame, UsageLedger} from '#services/game/schema.ts'
import {
	ActivityPage,
	Command,
	Entry,
	GameError,
	HistoryIndex,
	HistoryPage,
	Journal,
	LocalDecision,
	Saved,
	Timeline,
	UnitKind
} from '#services/game/schema.ts'
import {GENERATOR} from '#services/world/lib/utils.ts'

// How many rounds of a thread one page holds.
const PAGE = 20
// A replay starts from the latest checkpoint before it, one every few rounds.
const CHECKPOINT = 4

function padded(round: number) {
	return String.padStart(9, '0')(`${round}`)
}

function replayKey(kind: 'checkpoint' | 'journal' | 'local', tick: number) {
	return `${kind}/${SIMULATION}/${padded(tick)}`
}

function keyOf(team: number, round: number) {
	return `thread/${team}/${padded(round)}`
}

function notable(entry: Experience) {
	if (entry.context !== undefined) return false
	const unit = Schema.is(UnitKind)(entry.actorKind)
	if (entry.kind === 'born') return unit
	if (entry.kind === 'decision') {
		if (String.startsWith('Chose continue:')(entry.text) || String.startsWith('Chose rest:')(entry.text)) {
			return false
		}
		return (
			unit ||
			String.startsWith('Chose attack:')(entry.text) ||
			String.startsWith('Chose flee:')(entry.text) ||
			String.startsWith('Chose investigate:')(entry.text)
		)
	}
	if (entry.kind === 'observe') return unit || String.includes('a body lies here')(entry.text)
	if (entry.kind === 'action') return unit || entry.subject !== undefined
	return true
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
		readonly usage: Effect.Effect<UsageLedger, GameError>
		readonly history: (
			actor: number | 'all',
			before: Option.Option<number>,
			at?: number
		) => Effect.Effect<Experience[], GameError>
	}
>()('@deslop/signal/services/game/service/Game') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const running = (yield* pipe(Config.String('SIGNAL_RUN'), Config.withDefault('paused'))) === 'running'
			const kv = yield* KeyValueStore.KeyValueStore
			const worlds = KeyValueStore.toSchemaStore(kv, Saved)
			const entries = KeyValueStore.toSchemaStore(kv, Entry)
			const journals = KeyValueStore.toSchemaStore(kv, Journal)
			const timelines = KeyValueStore.toSchemaStore(kv, Timeline)
			const histories = KeyValueStore.toSchemaStore(kv, HistoryPage)
			const activity = KeyValueStore.toSchemaStore(kv, ActivityPage)
			const indexes = KeyValueStore.toSchemaStore(kv, HistoryIndex)
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
				Effect.mapError(cause =>
					GameError.make({cause, message: 'Signal refused to replace an unreadable saved world.'})
				)
			)
			if (Option.isNone(restored) && running) {
				yield* Effect.ignore(kv.clear, {log: 'Warn', message: 'Signal could not clear the old world'})
			}
			const sim = yield* Option.match(restored, {onNone: () => makeSim(Option.none(), fresh), onSome: Effect.succeed})
			const historyIndex = MutableRef.make(
				Option.getOrElse(yield* indexes.get('history/index'), () => Record.empty<string, number>())
			)

			const replayLocal = Effect.fnUntraced(function* (target: Effect.Success<ReturnType<typeof makeSim>>) {
				for (const choice of Option.match(yield* journals.get(replayKey('local', target.tick())), {
					onNone: () => [],
					onSome: found => found.locals ?? []
				})) {
					if (choice.choice !== undefined) target.decide(choice.actor, choice.choice, choice.request)
					if (choice.context !== undefined) {
						target.evidence(choice.actor, choice.context, choice.tokens ?? {}, choice.failure)
					}
					if (choice.next !== undefined) target.defer(choice.actor, choice.next)
				}
			})
			const replayBoundary = Effect.fnUntraced(function* (target: Effect.Success<ReturnType<typeof makeSim>>) {
				const recorded = Option.getOrUndefined(yield* journals.get(replayKey('journal', target.tick() / ROUND)))
				if (recorded === undefined) {
					return yield* GameError.make({
						message: 'A required replay boundary is missing; Signal will not invent its events.'
					})
				}
				for (const entry of recorded.applied) target.apply(entry.team, Array.filter(entry.commands, Schema.is(Command)))
				target.marks()
				for (const team of recorded.observed ?? []) target.observe(team)
			})
			const advanceRecorded = Effect.fnUntraced(function* (
				target: Effect.Success<ReturnType<typeof makeSim>>,
				ticks: number
			) {
				if (ticks <= 0) return
				yield* Effect.forEach(
					Array.range(1, ticks),
					Effect.fnUntraced(function* (step) {
						yield* target.run(1)
						if (step % 100 === 0) yield* Effect.yieldNow
						if (target.tick() % TICK_HZ === 0) yield* replayLocal(target)
						if (target.tick() % ROUND === 0) yield* replayBoundary(target)
					}),
					{concurrency: 1, discard: true}
				)
			})
			const resumed = Option.getOrUndefined(yield* worlds.get('world'))
			if (resumed?.rules === SIMULATION) {
				const through = Array.reduce(
					yield* kv.keys,
					Number.max(
						sim.tick(),
						Boolean.match(MutableRef.get(historyIndex)['@rules'] === SIMULATION, {
							onFalse: () => 0,
							onTrue: () => MutableRef.get(historyIndex)['@tick'] ?? 0
						})
					),
					(latest, key) => {
						const [kind, rules, encoded = ''] = String.split('/')(key)
						if (rules !== `${SIMULATION}` || (kind !== 'local' && kind !== 'journal')) return latest
						return Number.max(
							latest,
							Option.getOrElse(Number.parse(encoded), () => 0) *
								Option.match(
									Option.filter(Option.some(kind), value => value === 'journal'),
									{onNone: () => 1, onSome: () => ROUND}
								)
						)
					}
				)
				yield* advanceRecorded(sim, through - sim.tick())
			}
			const fault = MutableRef.make(Option.none<GameError>())
			const core = yield* Core
			const scope = yield* Effect.scope
			// Each team's decision under way, for the round it was asked in; and the entry its round opened with.
			const thinking = MutableHashMap.empty<number, {entry: Entry; fiber: Fiber.Fiber<Thought, GameError>}>()
			const recent = MutableHashMap.empty<number, Entry[]>()
			const threadKeys = MutableRef.make(
				Array.sort(
					Array.filter(yield* kv.keys, key => String.startsWith('thread/')(key)),
					String.Order
				)
			)
			const local = MutableHashMap.empty<number, {fiber: Fiber.Fiber<LocalChoice, GameError>; request: LocalDecision}>()
			const localBudget = Number.clamp(
				Math.floor(yield* pipe(Config.Number('SIGNAL_LOCAL_DECISIONS_PER_SECOND'), Config.withDefault(2))),
				{maximum: 4, minimum: 0}
			)

			const clock = yield* Semaphore.make(1)
			const save = pipe(
				Effect.flatMap(clock.withPermit(sim.snapshot), saved => worlds.set('world', saved)),
				Effect.mapError(cause => GameError.make({cause, message: 'Simulation stopped: the world could not be saved.'}))
			)

			const actorPage = Effect.fn('Game.actorPage')(function* (actor: string, page: number, index: HistoryIndex) {
				const expected = Number.clamp((index[actor] ?? 0) - page * 100, {maximum: 100, minimum: 0})
				if (expected === 0) return Array.empty<Experience>()
				const entriesInPage = Option.getOrElse(yield* histories.get(`history/${actor}/${padded(page)}`), () => [])
				if (entriesInPage.length < expected) {
					return yield* GameError.make({message: 'A committed individual history page is missing or incomplete.'})
				}
				return Array.take(entriesInPage, expected)
			})

			const appendHistory = Effect.fn('Game.appendHistory')(function* (
				actor: string,
				incoming: readonly Experience[],
				index: HistoryIndex
			) {
				const count = index[actor] ?? 0
				const page = Math.floor(count / 100)
				const prefix = yield* actorPage(actor, page, index)
				const through = yield* Option.match(Array.last(prefix), {
					onNone: () =>
						Effect.map(actorPage(actor, Math.floor(Number.max(0, count - 1) / 100), index), rows =>
							Option.getOrElse(
								Option.map(Array.last(rows), entry => entry.id),
								() => 0
							)
						),
					onSome: entry => Effect.succeed(entry.id)
				})
				const novel = Array.filter(incoming, entry => entry.id > through)
				const references = MutableList.make<ActivityPage[number]>()
				for (const chunk of Array.map(Array.chunksOf([...prefix, ...novel], 100), (rows, offset) => ({offset, rows}))) {
					yield* histories.set(`history/${actor}/${padded(page + chunk.offset)}`, chunk.rows)
					MutableList.appendAll(
						references,
						Array.map(
							Array.filter(chunk.rows, entry => entry.id > through && notable(entry)),
							entry => ({actor: entry.actor, id: entry.id, page: page + chunk.offset, tick: entry.tick})
						)
					)
				}
				return {count: count + novel.length, references: MutableList.toArray(references)}
			})

			const keepHistory = Effect.fn('Game.keepHistory')(
				function* () {
					const committed = MutableRef.get(historyIndex)
					const pending = sim.experiences()
					const updated = MutableHashMap.fromIterable(Record.toEntries(committed))
					const references = MutableList.make<ActivityPage[number]>()
					for (const group of Record.toEntries(
						Array.groupBy(
							Array.filter(pending, entry => entry.id > (committed['@through'] ?? 0)),
							entry => `${entry.actor}`
						)
					)) {
						const appended = yield* appendHistory(group[0], group[1], committed)
						MutableHashMap.set(updated, group[0], appended.count)
						MutableList.appendAll(references, appended.references)
					}
					const count = committed['@activity'] ?? 0
					const page = Math.floor(count / 100)
					const prefix = Array.take(
						Option.getOrElse(yield* activity.get(`activity/${padded(page)}`), () => []),
						count % 100
					)
					if (prefix.length !== count % 100) {
						return yield* GameError.make({message: 'A committed world chronicle page is missing or incomplete.'})
					}
					const novel = Array.sortWith(MutableList.toArray(references), entry => entry.id, Number.Order)
					for (const chunk of Array.map(Array.chunksOf([...prefix, ...novel], 100), (rows, offset) => ({
						offset,
						rows
					}))) {
						yield* activity.set(`activity/${padded(page + chunk.offset)}`, chunk.rows)
					}
					const index = {
						...Record.fromEntries(updated),
						'@activity': count + novel.length,
						'@rules': SIMULATION,
						'@through': Option.getOrElse(
							Option.map(Array.last(pending), entry => entry.id),
							() => committed['@through'] ?? 0
						),
						'@tick': sim.tick()
					}
					// Every canonical page and reference is durable before the one visible frontier advances.
					yield* indexes.set('history/index', index)
					MutableRef.set(historyIndex, index)
					if (Array.isArrayNonEmpty(pending)) sim.acknowledge(Option.getOrThrow(Array.last(pending)).id)
				},
				Effect.mapError(cause =>
					GameError.make({cause, message: 'Simulation stopped: history could not be committed.'})
				)
			)
			const started = MutableRef.make({at: yield* Clock.currentTimeMillis, tick: sim.tick()})
			const timeline = MutableRef.make(
				Option.getOrElse(yield* Effect.orElseSucceed(timelines.get('timeline'), () => Option.none()), () => ({
					live: sim.tick(),
					marks: [],
					start: resumed?.tick ?? sim.tick()
				}))
			)

			if (resumed?.rules !== SIMULATION) {
				MutableRef.update(timeline, previous => ({...previous, live: sim.tick(), start: sim.tick()}))
			}

			const record = Effect.fn('Game.record')(function* (entry: Entry) {
				yield* pipe(
					entries.set(keyOf(entry.team, entry.round), entry),
					Effect.mapError(cause =>
						GameError.make({cause, message: 'Simulation stopped: a Core conversation could not be archived.'})
					),
					Effect.tapError(error => Effect.sync(() => MutableRef.set(fault, Option.some(error))))
				)
				MutableHashMap.set(
					recent,
					entry.team,
					Array.takeRight([...Option.getOrElse(MutableHashMap.get(recent, entry.team), () => []), entry], 60)
				)
				MutableRef.update(threadKeys, keys =>
					Array.sort(Array.dedupe([...keys, keyOf(entry.team, entry.round)]), String.Order)
				)
			})

			// The world as a boundary leaves it, for replays to start from; the one six hours (720 rounds) older goes unless it is one of every forty kept for good.
			const checkpoint = Effect.fn('Game.checkpoint')(
				function* (round: number) {
					yield* worlds.set(replayKey('checkpoint', round), yield* sim.snapshot)
					const old = round - 720
					if (old > 0 && old % 40 !== 0) yield* kv.remove(replayKey('checkpoint', old))
				},
				Effect.mapError(cause =>
					GameError.make({cause, message: 'Simulation stopped: a replay checkpoint could not be saved.'})
				)
			)

			// A team's decision at the first boundary after it came, within three rounds of being asked: a team still thinking keeps thinking and is not asked again; past the third round its decision is recorded as late (a failed one was recorded when it failed). The thread keeps it under the round it applied at, so a replay never shows a decision before it was made. What applied goes back for the journal.
			const settle = Effect.fnUntraced(function* (
				team: number,
				round: number,
				pending: {entry: Entry; fiber: Fiber.Fiber<Thought, GameError>}
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
				const applied = yield* Effect.forEach(
					exit.value.commands,
					command => {
						if (command._tag === 'Recall') {
							return Effect.map(core.recall(sim.seed, team, command.before, command.offset), text => {
								const result = {command, ok: true, text}
								sim.receive(team, result)
								return result
							})
						}
						return Effect.succeed(Option.getOrThrow(Array.head(sim.apply(team, [command]))))
					},
					{concurrency: 1}
				)
				yield* record({
					...pending.entry,
					commands: applied,
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

				const observed = MutableList.make<number>()
				yield* Effect.forEach(
					Array.filter(teams, id => !MutableHashMap.has(thinking, id)),
					Effect.fnUntraced(function* (team) {
						const seen = sim.observe(team)
						MutableList.append(observed, team)
						if (
							round !== 1 &&
							round % 10 !== 0 &&
							Array.isReadonlyArrayEmpty(seen.notices) &&
							!Array.some(applied, entry => entry.team === team && Array.isReadonlyArrayNonEmpty(entry.commands))
						) {
							return
						}
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
									sim.seed,
									team,
									Array.join([...Array.map(seen.notices, notice => `Notice: ${notice}`), seen.text], '\n'),
									sim.discovered(team)
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
					}),
					{concurrency: 1, discard: true}
				)
				yield* journals.set(replayKey('journal', round), {
					applied,
					marks,
					observed: MutableList.toArray(observed),
					round
				})
				yield* timelines.set('timeline', MutableRef.get(timeline))
				if (round % CHECKPOINT === 0) yield* checkpoint(round)
			})

			const tickOnce = pipe(
				clock.withPermit(
					Effect.uninterruptible(
						Effect.gen(function* () {
							yield* sim.run(1)
							if (sim.tick() % TICK_HZ === 0) {
								const completed = Array.filter(
									Array.fromIterable(local),
									entry => entry[1].fiber.pollUnsafe() !== undefined
								)
								const applied = MutableList.make<NonNullable<Journal['locals']>[number]>()
								for (const entry of completed) {
									const result = entry[1].fiber.pollUnsafe()
									MutableHashMap.remove(local, entry[0])
									if (result !== undefined && Exit.isSuccess(result)) {
										sim.decide(entry[0], result.value.choice, entry[1].request)
										const context = yield* Option.match(Option.fromUndefinedOr(result.value.context), {
											onNone: () => Schema.encodeEffect(Schema.fromJsonString(LocalDecision))(entry[1].request),
											onSome: Effect.succeed
										})
										const tokens = {cost: result.value.cost, input: result.value.input, output: result.value.output}
										sim.evidence(entry[0], context, tokens)
										MutableList.append(applied, {
											actor: entry[0],
											choice: result.value.choice,
											context,
											request: entry[1].request,
											tick: sim.tick(),
											tokens
										})
									} else if (result !== undefined) {
										const failure = Cause.pretty(result.cause)
										sim.evidence(entry[0], entry[1].request.state, {}, failure)
										MutableList.append(applied, {
											actor: entry[0],
											context: entry[1].request.state,
											failure,
											tick: sim.tick()
										})
										yield* Effect.logWarning('A local decision failed; existing action continues', result)
									}
								}
								for (const request of Array.getSomes(
									Array.map(
										Array.take(
											Array.sortWith(
												Array.filter(sim.due(), actor => !MutableHashMap.has(local, actor)),
												(actor: number) => sim.individual(actor).next,
												Number.Order
											),
											Number.min(localBudget, Number.max(0, 4 - MutableHashMap.size(local)))
										),
										sim.decision
									)
								)) {
									const deadline = sim.tick() + 60 * TICK_HZ
									sim.defer(request.actor, deadline)
									MutableList.append(applied, {actor: request.actor, next: deadline, tick: sim.tick()})
									MutableHashMap.set(local, request.actor, {
										fiber: yield* Effect.forkIn(core.choose(sim.seed, request), scope),
										request
									})
								}

								if (Array.isArrayNonEmpty(MutableList.toArray(applied))) {
									yield* journals.set(replayKey('local', sim.tick()), {
										applied: [],
										locals: MutableList.toArray(applied),
										marks: [],
										round: Math.floor(sim.tick() / ROUND)
									})
								}
								if (sim.tick() % ROUND === 0) yield* boundary(sim.tick() / ROUND)
							}
						})
					)
				),
				Effect.andThen(
					Effect.suspend(() => {
						if (sim.tick() % TICK_HZ !== 0) return Effect.void
						if (sim.tick() % (15 * TICK_HZ) === 0) return pipe(save, Effect.andThen(keepHistory()))
						return keepHistory()
					})
				)
			)

			// The world keeps time with the wall clock in whole ticks; a server that fell more than two seconds behind skips the rest rather than racing to catch up.
			const advance = Effect.gen(function* () {
				if (Option.isSome(MutableRef.get(fault))) {
					for (const pending of MutableHashMap.values(local)) yield* Fiber.interrupt(pending.fiber)
					for (const pending of MutableHashMap.values(thinking)) yield* Fiber.interrupt(pending.fiber)
					MutableHashMap.clear(local)
					MutableHashMap.clear(thinking)
					return
				}
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
			if (running) {
				yield* Effect.addFinalizer(() => Effect.ignore(save, {log: 'Error', message: 'Final Signal save failed'}))
				yield* checkpoint(Math.floor(sim.tick() / ROUND))
				yield* Effect.forkScoped(
					Effect.repeat(
						Effect.catch(advance, error =>
							Effect.gen(function* () {
								MutableRef.set(fault, Option.some(error))
								for (const pending of MutableHashMap.values(local)) yield* Fiber.interrupt(pending.fiber)
								for (const pending of MutableHashMap.values(thinking)) yield* Fiber.interrupt(pending.fiber)
								yield* Effect.logError('Simulation stopped after a persistence or simulation failure', error)
							})
						),
						Schedule.spaced(`${TICK * 1000} millis`)
					)
				)
			}

			// The latest checkpoint at or before a round, searching back on the checkpoint rounds.
			const checkpointBefore = Effect.fnUntraced(function* (from: number) {
				for (const at of Array.reverse(Array.range(0, Math.floor(from / ROUND / CHECKPOINT)))) {
					const found = yield* worlds.get(replayKey('checkpoint', at * CHECKPOINT))
					if (Option.exists(found, saved => saved.tick <= from && saved.rules === SIMULATION)) return found
				}
				return Option.none<Saved>()
			})

			// A replay's own world: the checkpoint before `from`, run on with the journal's commands at each boundary.
			const replayFrom = Effect.fnUntraced(
				function* (from: number) {
					if (from < MutableRef.get(timeline).start) {
						return yield* GameError.make({
							message: 'This time predates the current simulation rules; original histories remain available.'
						})
					}
					const current = yield* clock.withPermit(
						Effect.suspend(() => {
							if (from !== sim.tick()) return Effect.succeedNone
							return Effect.asSome(sim.snapshot)
						})
					)
					const start = Option.filter(
						yield* Option.match(current, {onNone: () => checkpointBefore(from), onSome: Effect.succeedSome}),
						found => found.generator === GENERATOR
					)
					if (Option.isNone(start)) {
						return yield* GameError.make({message: 'The replay has no checkpoint that early.'})
					}
					const replayed = yield* makeSim(start, 0)
					function run(ticks: number) {
						return Effect.tap(advanceRecorded(replayed, ticks), () =>
							Effect.sync(() => {
								Option.match(Array.last(replayed.experiences()), {
									onNone: () => undefined,
									onSome: entry => replayed.acknowledge(entry.id)
								})
							})
						)
					}
					yield* run(from - replayed.tick())
					return {run, sim: replayed}
				},
				Effect.mapError(cause => {
					if (Schema.is(GameError)(cause)) return cause
					return GameError.make({cause, message: 'The replay could not start.'})
				})
			)

			return Game.of({
				history: Effect.fn('Game.history')(
					function* (actor: number | 'all', before: Option.Option<number>, at = 9_007_199_254_740_991) {
						const index = MutableRef.get(historyIndex)
						const count =
							index[Boolean.match(actor === 'all', {onFalse: () => `${actor}`, onTrue: () => '@activity'})] ?? 0
						function matches(entry: {id: number; tick: number}) {
							return entry.tick <= at && Option.match(before, {onNone: () => true, onSome: id => entry.id < id})
						}
						const found = MutableHashMap.fromIterable(
							Array.map(
								Array.filter(
									sim.experiences(),
									entry => (entry.actor === actor || (actor === 'all' && notable(entry))) && matches(entry)
								),
								entry => [entry.id, entry] as const
							)
						)
						const cached = MutableHashMap.empty<string, readonly Experience[]>()
						const read = Effect.fnUntraced(function* (page: number) {
							if (actor === 'all') {
								const expected = Number.min(100, count - page * 100)
								const rows = Option.getOrElse(yield* activity.get(`activity/${padded(page)}`), () => [])
								if (rows.length < expected) {
									return yield* GameError.make({message: 'A committed world chronicle page is missing or incomplete.'})
								}
								return Array.take(rows, expected)
							}
							const rows = yield* actorPage(`${actor}`, page, index)
							MutableHashMap.set(cached, `${actor}:${page}`, rows)
							return Array.map(rows, entry => ({actor: entry.actor, id: entry.id, page, tick: entry.tick}))
						})
						const resolve = Effect.fnUntraced(function* (reference: ActivityPage[number]) {
							const key = `${reference.actor}:${reference.page}`
							const rows = yield* Option.match(MutableHashMap.get(cached, key), {
								onNone: () =>
									pipe(
										actorPage(`${reference.actor}`, reference.page, index),
										Effect.tap(entriesInPage => Effect.sync(() => MutableHashMap.set(cached, key, entriesInPage)))
									),
								onSome: Effect.succeed
							})
							return yield* Effect.fromOption(
								Array.findFirst(rows, entry => entry.id === reference.id),
								() => GameError.make({message: 'A world chronicle reference has no canonical individual event.'})
							)
						})
						if (count === 0 || MutableHashMap.size(found) >= 100) {
							return Array.takeRight(
								Array.sortWith(Array.fromIterable(MutableHashMap.values(found)), entry => entry.id, Number.Order),
								100
							)
						}
						const bounds = {high: Math.floor((count - 1) / 100), low: 0}
						while (bounds.low < bounds.high) {
							const middle = Math.ceil((bounds.low + bounds.high) / 2)
							if (
								Option.exists(
									Array.head(yield* read(middle)),
									entry => entry.tick > at || Option.exists(before, cursor => entry.id >= cursor)
								)
							) {
								bounds.high = middle - 1
							} else {
								bounds.low = middle
							}
						}
						for (const page of Array.reverse(Array.range(0, bounds.low))) {
							for (const reference of Array.filter(yield* read(page), matches)) {
								const entry = yield* resolve(reference)
								MutableHashMap.set(found, entry.id, entry)
							}
							if (MutableHashMap.size(found) >= 100) break
						}
						return Array.takeRight(
							Array.sortWith(Array.fromIterable(MutableHashMap.values(found)), entry => entry.id, Number.Order),
							100
						)
					},
					Effect.mapError(cause => GameError.make({cause, message: 'The chronicle could not be read.'}))
				),

				join: Stream.unwrap(
					Effect.gen(function* () {
						const id = yield* Effect.acquireRelease(
							Effect.sync(() => sim.connect()),
							connection => Effect.sync(() => sim.disconnect(connection))
						)
						const sent = MutableRef.make(Option.none<string>())
						return pipe(
							Stream.tick(`${1000 / FRAME_HZ} millis`),
							Stream.mapEffect(() =>
								Effect.suspend(() => {
									const version = `${sim.tick()}:${Option.getOrElse(
										Option.map(MutableRef.get(fault), error => error.message),
										() => ''
									)}`
									if (Option.contains(MutableRef.get(sent), version)) return Effect.succeedNone
									MutableRef.set(sent, Option.some(version))
									return Effect.map(Clock.currentTimeMillis, now =>
										Option.map(sim.frame(id, now), frame => ({
											...frame,
											paused: !running || Option.isSome(MutableRef.get(fault)),
											problem: Option.getOrUndefined(Option.map(MutableRef.get(fault), error => error.message))
										}))
									)
								})
							),
							Stream.flatMap(frame => Stream.fromIterable(Option.toArray(frame)))
						)
					})
				),
				replay: (from, speed) =>
					Stream.unwrap(
						Effect.gen(function* () {
							const replay = yield* replayFrom(Number.min(from, sim.tick()))
							const id = yield* Effect.acquireRelease(
								Effect.sync(() => replay.sim.connect()),
								connection => Effect.sync(() => replay.sim.disconnect(connection))
							)
							const sent = MutableRef.make(-1)
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
										if (MutableRef.get(sent) === replay.sim.tick()) return Option.none<Frame>()
										MutableRef.set(sent, replay.sim.tick())
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
								Array.takeRight(
									Array.filter(
										MutableRef.get(threadKeys),
										key => String.startsWith(`thread/${team}/`)(key) && key < keyOf(team, last)
									),
									PAGE
								),
								key => entries.get(key),
								{concurrency: 'unbounded'}
							)
						)
					},
					Effect.mapError(cause => GameError.make({cause, message: 'The thread could not be read.'}))
				),
				timeline: Effect.sync(() => MutableRef.get(timeline)),
				usage: core.usage
			})
		})
	)
}
