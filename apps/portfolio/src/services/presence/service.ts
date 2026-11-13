import {
	Array,
	Boolean,
	Context,
	DateTime,
	Duration,
	Effect,
	Layer,
	Number,
	Option,
	Record,
	Schedule,
	Stream,
	SubscriptionRef,
	pipe
} from 'effect'

import {hasMeaningfulMove, upsertVisitor} from './lib/utils.ts'
import type {Scene} from './schema.ts'
import {Color, Visitor, VisitorId} from './schema.ts'

const SERVER_BOTS = [
	{
		color: Color.literals[3],
		id: VisitorId.make('server-alpha'),
		name: 'server-alpha',
		xFreq: 0.47,
		xPhase: 0,
		yFreq: 0.71,
		yPhase: 0
	},
	{
		color: Color.literals[5],
		id: VisitorId.make('server-beta'),
		name: 'server-beta',
		xFreq: 0.83,
		xPhase: Math.PI,
		yFreq: 0.53,
		yPhase: Math.PI / 2
	}
] as const

export class Presence extends Context.Service<
	Presence,
	{
		readonly join: (payload: Pick<Visitor, 'color' | 'id' | 'name'>) => Stream.Stream<Scene>
		readonly move: (payload: Pick<Visitor, 'color' | 'id' | 'x' | 'y'>) => Effect.Effect<void>
	}
>()('@deslop/portfolio/services/presence/service/Presence') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const start = yield* DateTime.now
			// One cursor per identity; a visitor remains until its last tab closes.
			const room = yield* SubscriptionRef.make<Scene & {tabs: Record<VisitorId, number>}>({
				bots: [],
				tabs: {},
				visitors: []
			})
			const wander = Stream.fromEffectSchedule(
				Effect.map(DateTime.now, now =>
					Array.map(SERVER_BOTS, bot =>
						Visitor.make({
							color: bot.color,
							id: bot.id,
							name: bot.name,
							x: Number.clamp(
								0.5 + 0.4 * Math.sin(Duration.toSeconds(DateTime.distance(start, now)) * bot.xFreq + bot.xPhase),
								{maximum: 0.995, minimum: 0.005}
							),
							y: Number.clamp(
								0.5 + 0.4 * Math.cos(Duration.toSeconds(DateTime.distance(start, now)) * bot.yFreq + bot.yPhase),
								{maximum: 0.995, minimum: 0.005}
							)
						})
					)
				),
				Schedule.spaced('55 millis')
			)
			// One untraced timer for the room, interrupted as soon as the last tab leaves.
			yield* pipe(
				SubscriptionRef.changes(room),
				Stream.map(scene => !Array.isReadonlyArrayEmpty(scene.visitors)),
				Stream.changes,
				Stream.switchMap(occupied => Boolean.match(occupied, {onFalse: () => Stream.empty, onTrue: () => wander})),
				Stream.runForEach(bots =>
					SubscriptionRef.updateSome(room, scene => {
						if (Array.isReadonlyArrayEmpty(scene.visitors)) return Option.none()
						return Option.some({...scene, bots})
					})
				),
				Effect.forkScoped
			)

			return Presence.of({
				join: payload =>
					Stream.withSpan(
						Stream.unwrap(
							Effect.gen(function* () {
								yield* Effect.acquireRelease(
									SubscriptionRef.update(room, scene => ({
										...scene,
										tabs: {...scene.tabs, [payload.id]: (scene.tabs[payload.id] ?? 0) + 1},
										visitors: upsertVisitor(scene.visitors, Visitor.make({...payload, x: 0.5, y: 0.5}))
									})),
									() =>
										SubscriptionRef.update(room, scene => {
											const remaining = Option.getOrThrow(Record.get(scene.tabs, payload.id)) - 1
											if (remaining > 0) return {...scene, tabs: {...scene.tabs, [payload.id]: remaining}}
											const visitors = Array.filter(scene.visitors, visitor => visitor.id !== payload.id)
											return {
												bots: Boolean.match(Array.isReadonlyArrayEmpty(visitors), {
													onFalse: () => scene.bots,
													onTrue: () => []
												}),
												tabs: Record.remove(scene.tabs, payload.id),
												visitors
											}
										})
								)
								return pipe(
									SubscriptionRef.changes(room),
									Stream.map(scene => ({bots: scene.bots, visitors: scene.visitors})),
									Stream.buffer({capacity: 1, strategy: 'sliding'})
								)
							})
						),
						'Presence.join',
						{attributes: {'rpc.stream': true, visitorId: payload.id}}
					),
				move: payload =>
					SubscriptionRef.updateSome(room, scene =>
						pipe(
							scene.visitors,
							Array.findFirstIndex(
								visitor =>
									visitor.id === payload.id && (visitor.color !== payload.color || hasMeaningfulMove(visitor, payload))
							),
							Option.map(index => ({
								...scene,
								visitors: Array.map(scene.visitors, (visitor, position) => {
									if (position === index) return {...visitor, ...payload}
									return visitor
								})
							}))
						)
					)
			})
		})
	)
}
