import {
	Array,
	Clock,
	Config,
	Context,
	Effect,
	Layer,
	MutableHashMap,
	Option,
	Path,
	Predicate,
	Schedule,
	Stream,
	pipe
} from 'effect'

import {KeyValueStore} from 'effect/persistence'

import {layerKeyValueStore} from '@deslop/runtime/server'

import type {EncounterResponse, Plan, RaidResponse} from '#services/core/schema.ts'
import {Core} from '#services/core/service.ts'
import {makeWorld} from '#services/game/lib/sim.ts'
import type {WorldEvent} from '#services/game/lib/sim.ts'
import {FRAME_HZ, TICK_HZ} from '#services/game/lib/utils.ts'
import type {Action, Frame, Reply, Steer} from '#services/game/schema.ts'
import {GameError, Saved} from '#services/game/schema.ts'

type User = {id: string; name: string}

export class Game extends Context.Service<
	Game,
	{
		readonly join: (user: User, invite?: string) => Stream.Stream<Frame>
		readonly steer: (user: User, steer: Steer & {px: number; pz: number}) => Effect.Effect<void>
		readonly act: (user: User, action: Action) => Effect.Effect<string, GameError>
		readonly ask: (user: User, input: {drone?: number; text: string}) => Stream.Stream<Reply, GameError>
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
			const world = makeWorld(
				yield* pipe(
					store.get('world'),
					Effect.catch(cause =>
						Effect.as(
							Effect.logWarning('Signal starts a fresh world: the saved one is unreadable', cause),
							Option.none()
						)
					)
				)
			)
			world.restore(yield* Clock.currentTimeMillis)
			const core = yield* Core
			const reviews = MutableHashMap.empty<string, number>()
			const decisions = MutableHashMap.empty<string, number>()

			const save = pipe(
				Effect.suspend(() => store.set('world', world.snapshot())),
				Effect.catch(cause => Effect.logError('Signal could not save the world', cause))
			)

			const apply = Effect.fn('Game.apply')(function* (owner: string, actions: Plan['orders']) {
				const now = yield* Clock.currentTimeMillis
				const results = Array.map(actions, action => world.act(owner, action, now))
				yield* Effect.annotateCurrentSpan({actions: Array.map(results, result => result.summary)})
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

			// Every model call CORE makes on its own slows as the player goes quiet: its interval doubles per 12 idle hours and stops at 72.
			function paced(
				last: MutableHashMap.MutableHashMap<string, number>,
				player: string,
				interval: number,
				now: number
			) {
				const idle = world.idleHours(player, now)
				if (idle >= 72) return false
				if (now - Option.getOrElse(MutableHashMap.get(last, player), () => 0) < interval * 2 ** (idle / 12)) {
					return false
				}
				MutableHashMap.set(last, player, now)
				return true
			}

			// Jev picks the response to a raid or a stranger; when paced out or unreachable, the safe default applies.
			function consult<A>(player: string, now: number, call: () => Effect.Effect<A, GameError>, fallback: A) {
				if (!paced(decisions, player, 15_000, now)) return Effect.succeed(fallback)
				return Effect.orElseSucceed(call(), () => fallback)
			}

			const decide = Effect.fn('Game.decide')(function* (event: WorldEvent) {
				const now = yield* Clock.currentTimeMillis
				const context = world.summary(event.player)
				const at = `${Math.floor(event.at.x)},${Math.floor(event.at.z)}`
				if (event._tag === 'Raid') {
					const answer = yield* consult<RaidResponse>(
						event.player,
						now,
						() => core.raid(context, `Glitches raided the hauler route ${event.route} at ${at}.`),
						'escort'
					)
					if (answer === 'escort') {
						world.act(
							event.player,
							{_tag: 'Assign', routine: {_tag: 'Escort', group: 'mining'}, selector: {count: 2, kind: 'guard'}},
							now
						)
					}
					if (answer === 'reroute') world.avoid(event.player, event.route, now)
					return
				}
				const answer = yield* consult<EncounterResponse>(
					event.player,
					now,
					() => core.encounter(context, `Our drones met drones of ${event.name} at ${at}.`),
					'watch'
				)
				if (answer === 'watch') {
					world.act(
						event.player,
						{_tag: 'Assign', routine: {_tag: 'Track', player: event.name}, selector: {count: 1, kind: 'scout'}},
						now
					)
				}
				if (answer === 'avoid') {
					world.act(event.player, {_tag: 'Assign', routine: {_tag: 'Return'}, selector: {kind: 'miner'}}, now)
				}
			})

			// CORE reviews events on its own at most every 2 minutes while the player is around.
			const review = Effect.fn('Game.review')(function* (event: WorldEvent) {
				if (!paced(reviews, event.player, 120_000, yield* Clock.currentTimeMillis)) return
				const last = yield* Stream.runLast(
					core.plan({autonomous: true, context: world.summary(event.player), text: `${event._tag} event`})
				)
				yield* Option.match(
					Option.flatMap(last, draft => draft.plan),
					{onNone: () => Effect.void, onSome: plan => Effect.asVoid(apply(event.player, plan.orders))}
				)
			})

			yield* Effect.forkScoped(
				Effect.repeat(
					Effect.flatMap(Clock.currentTimeMillis, now => Effect.sync(() => world.step(now))),
					Schedule.fixed(`${1000 / TICK_HZ} millis`)
				)
			)
			yield* Effect.forkScoped(Effect.repeat(save, Schedule.spaced('15 seconds')))
			yield* Effect.addFinalizer(() => save)
			yield* Effect.forkScoped(
				Effect.repeat(
					Effect.flatMap(Effect.sync(world.drain), events =>
						Effect.forEach(
							events,
							event =>
								Effect.ignore(Effect.andThen(decide(event), review(event)), {
									log: 'Warn',
									message: 'CORE skipped an event'
								}),
							{concurrency: 4, discard: true}
						)
					),
					Schedule.spaced('1 second')
				)
			)

			return Game.of({
				act: Effect.fn('Game.act')(function* (user, action) {
					const now = yield* Clock.currentTimeMillis
					world.touch(user.id, now)
					const result = world.act(user.id, action, now)
					if (!result.ok) return yield* GameError.make({message: result.summary})
					return result.summary
				}),
				// The answer streams as the planner writes it; once the plan is whole its orders apply, and the reply lists which went through and which the world refused.
				ask: (user, input) =>
					Stream.unwrap(
						Effect.map(Clock.currentTimeMillis, now => {
							world.touch(user.id, now)
							return Stream.mapEffect(
								core.plan({autonomous: false, context: world.summary(user.id, input.drone), text: input.text}),
								draft =>
									Option.match(draft.plan, {
										onNone: () => Effect.succeed<Reply>({answer: draft.answer, done: false, orders: [], refused: []}),
										onSome: plan =>
											Effect.map(apply(user.id, plan.orders), results => ({
												answer: plan.answer,
												done: true,
												...results
											}))
									})
							)
						})
					),
				join: (user, invite) =>
					Stream.unwrap(
						Effect.gen(function* () {
							const id = yield* Effect.acquireRelease(
								Effect.map(Clock.currentTimeMillis, now => world.connect(user, now, invite)),
								connection =>
									Effect.flatMap(Clock.currentTimeMillis, now => Effect.sync(() => world.disconnect(connection, now)))
							)
							return pipe(
								Stream.tick(`${1000 / FRAME_HZ} millis`),
								Stream.mapEffect(() =>
									Effect.gen(function* () {
										const now = yield* Clock.currentTimeMillis
										return world.frame(id, now, yield* core.status(world.idleHours(user.id, now)))
									})
								),
								Stream.filter(Predicate.isNotUndefined)
							)
						})
					),
				steer: Effect.fn('Game.steer')(function* (user, steer) {
					world.steer(user.id, steer, yield* Clock.currentTimeMillis)
				})
			})
		})
	)
}
