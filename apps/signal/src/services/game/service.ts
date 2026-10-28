import {
	Array,
	Clock,
	Config,
	Context,
	Effect,
	Layer,
	MutableHashMap,
	MutableRef,
	Option,
	Path,
	Random,
	Schedule,
	Stream,
	pipe
} from 'effect'

import {KeyValueStore} from 'effect/persistence'

import {layerKeyValueStore} from '@deslop/runtime/server'

import type {Plan} from '#services/core/schema.ts'
import {Core} from '#services/core/service.ts'
import {makeSim} from '#services/game/lib/sim.ts'
import type {GameEvent} from '#services/game/lib/sim.ts'
import {FRAME_HZ, TICK_HZ} from '#services/game/lib/utils.ts'
import type {Frame, GameError, Reply} from '#services/game/schema.ts'
import {Saved} from '#services/game/schema.ts'

type User = {id: string; name: string}

export class Game extends Context.Service<
	Game,
	{
		readonly join: (user: User) => Stream.Stream<Frame>
		readonly ask: (user: User, text: string) => Stream.Stream<Reply, GameError>
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
			const store = KeyValueStore.toSchemaStore(
				Context.get(yield* Layer.build(layerKeyValueStore(directory)), KeyValueStore.KeyValueStore),
				Saved
			)
			// A save from an older world model or generator does not decode or is set aside: the colony starts over.
			const saved = yield* pipe(
				store.get('colony'),
				Effect.catch(cause =>
					Effect.as(
						Effect.logWarning('Signal starts a fresh colony: the saved one is unreadable', cause),
						Option.none()
					)
				)
			)
			const sim = makeSim(saved, yield* Clock.currentTimeMillis, yield* Random.nextIntBetween(0, 2_000_000_000))
			const core = yield* Core
			const last = MutableRef.make(yield* Clock.currentTimeMillis)
			const reviewed = MutableHashMap.empty<string, number>()

			const save = pipe(
				Effect.suspend(() => store.set('colony', sim.snapshot())),
				Effect.catch(cause => Effect.logError('Signal could not save the colony', cause))
			)

			const apply = Effect.fn('Game.apply')(function* (orders: Plan['orders']) {
				const now = yield* Clock.currentTimeMillis
				const results = Array.map(orders, order => sim.act(order, now))
				yield* Effect.annotateCurrentSpan({orders: Array.map(results, result => result.summary)})
				return {
					orders: Array.map(
						Array.filter(results, result => result.ok),
						result => result.summary
					),
					refused: Array.map(
						Array.filter(results, result => !result.ok),
						result => result.summary
					)
				}
			})

			// A finished answer applies its orders and joins the conversation with what they did.
			const settle = Effect.fn('Game.settle')(function* (question: string, plan: Plan, now: number) {
				yield* Effect.annotateCurrentSpan({answer: plan.answer, question})
				const results = yield* apply(plan.orders)
				sim.say({at: now, by: 'CORE', orders: results.orders, refused: results.refused, text: plan.answer})
				return {answer: plan.answer, done: true, ...results} satisfies Reply
			})

			// CORE speaks up on its own only when its orders did something.
			const intervene = Effect.fnUntraced(function* (plan: Plan, now: number) {
				const results = yield* apply(plan.orders)
				if (Array.isArrayNonEmpty(results.orders)) {
					sim.say({at: now, by: 'CORE', orders: results.orders, refused: results.refused, text: plan.answer})
				}
			})

			// CORE looks at field events on its own at most every two minutes, and slows as the colony goes quiet: its interval doubles per 12 idle hours and stops at 72.
			const review = Effect.fn('Game.review')(function* (events: GameEvent[]) {
				const now = yield* Clock.currentTimeMillis
				const idle = sim.idleHours(now)
				const since = now - Option.getOrElse(MutableHashMap.get(reviewed, 'colony'), () => 0)
				if (Array.isArrayEmpty(events) || idle >= 72 || since < 120_000 * 2 ** (idle / 12)) return
				MutableHashMap.set(reviewed, 'colony', now)
				const draft = yield* Stream.runLast(
					core.plan({
						autonomous: true,
						context: sim.summary(),
						history: [],
						text: Array.join(
							Array.map(events, event => event.text),
							'; '
						)
					})
				)
				yield* Option.match(
					Option.flatMap(draft, entry => entry.plan),
					{onNone: () => Effect.void, onSome: plan => intervene(plan, now)}
				)
			})

			yield* Effect.forkScoped(
				Effect.repeat(
					Effect.flatMap(Clock.currentTimeMillis, now =>
						Effect.sync(() => {
							sim.step(now, MutableRef.get(last))
							MutableRef.set(last, now)
						})
					),
					Schedule.fixed(`${1000 / TICK_HZ} millis`)
				)
			)
			yield* Effect.forkScoped(Effect.repeat(save, Schedule.spaced('15 seconds')))
			yield* Effect.addFinalizer(() => save)
			yield* Effect.forkScoped(
				Effect.repeat(
					Effect.flatMap(Effect.sync(sim.drain), events =>
						Effect.ignore(review(events), {log: 'Warn', message: 'CORE skipped field events'})
					),
					Schedule.spaced('5 seconds')
				)
			)

			return Game.of({
				// The answer streams as the planner writes it, reading the conversation so far; once the plan is whole its orders apply, and the reply lists which went through and which the colony refused.
				ask: (user, text) =>
					Stream.unwrap(
						Effect.map(Clock.currentTimeMillis, now => {
							sim.touch(now)
							const history = sim.chat()
							sim.say({at: now, by: user.name, orders: [], refused: [], text})
							return pipe(
								core.plan({autonomous: false, context: sim.summary(), history, text}),
								Stream.mapEffect(draft =>
									Option.match(draft.plan, {
										onNone: () => Effect.succeed<Reply>({answer: draft.answer, done: false, orders: [], refused: []}),
										onSome: plan => settle(text, plan, now)
									})
								),
								Stream.tapError(error =>
									Effect.sync(() => sim.say({at: now, by: 'CORE', orders: [], refused: [], text: error.message}))
								)
							)
						})
					),
				join: user =>
					Stream.unwrap(
						Effect.gen(function* () {
							const id = yield* Effect.acquireRelease(
								Effect.map(Clock.currentTimeMillis, now => sim.connect(user.name, now)),
								connection => Effect.sync(() => sim.disconnect(connection))
							)
							return pipe(
								Stream.tick(`${1000 / FRAME_HZ} millis`),
								Stream.mapEffect(() =>
									Effect.gen(function* () {
										const now = yield* Clock.currentTimeMillis
										return sim.frame(id, now, yield* core.status(sim.idleHours(now)))
									})
								),
								Stream.flatMap(frame => Stream.fromIterable(Option.toArray(frame)))
							)
						})
					)
			})
		})
	)
}
