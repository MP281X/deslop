import {
	Array,
	Boolean,
	Clock,
	Context,
	DateTime,
	Duration,
	Effect,
	Function,
	Layer,
	MutableHashMap,
	Number,
	Option,
	Record,
	Schedule,
	Stream,
	SubscriptionRef,
	pipe
} from 'effect'

import {hasMeaningfulMove, upsertVisitor} from './lib/utils.ts'
import type {JoinVisitor, MoveVisitor, RecolorVisitor, Scene} from './schema.ts'
import {Color, PresenceError, Visitor, VisitorId} from './schema.ts'

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
		readonly join: (payload: JoinVisitor, connection: number) => Stream.Stream<Scene, PresenceError>
		readonly move: (payload: MoveVisitor, connection: number) => Effect.Effect<void, PresenceError>
		readonly recolor: (payload: RecolorVisitor, connection: number) => Effect.Effect<void, PresenceError>
	}
>()('@deslop/portfolio/services/presence/service/Presence') {
	static readonly layer = Layer.effect(
		this,
		// Visitor state should not outlive the running room.
		Effect.gen(function* () {
			const start = yield* DateTime.now
			// At most 128 visitors and 256 joined sockets; each socket owns one cursor identity.
			const connections = MutableHashMap.empty<number, {id: VisitorId; lastMove: number}>()
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
				join: (payload, connection) =>
					// A connection's trace should include its departure, not just admission.
					Stream.withSpan(
						Stream.unwrap(
							Effect.gen(function* () {
								const admitted = yield* Effect.acquireRelease(
									SubscriptionRef.modify(room, scene => {
										const tabs = Record.get(scene.tabs, payload.id)
										if (
											MutableHashMap.has(connections, connection) ||
											MutableHashMap.size(connections) >= 256 ||
											(Option.isNone(tabs) && scene.visitors.length >= 128)
										) {
											return [false, scene]
										}
										MutableHashMap.set(connections, connection, {id: payload.id, lastMove: -Infinity})
										return [
											true,
											{
												...scene,
												tabs: {...scene.tabs, [payload.id]: Option.getOrElse(tabs, Function.constant(0)) + 1},
												visitors: Boolean.match(Option.isNone(tabs), {
													onFalse: () => scene.visitors,
													onTrue: () => upsertVisitor(scene.visitors, Visitor.make({...payload, x: 0.5, y: 0.5}))
												})
											}
										]
									}),
									accepted => {
										if (!accepted) return Effect.void
										return SubscriptionRef.update(room, scene => {
											MutableHashMap.remove(connections, connection)
											return pipe(
												scene.tabs,
												Record.modify(payload.id, count => count - 1),
												Option.match({
													onNone: () => scene,
													onSome: updated => {
														const tabs = Record.filter(updated, count => count > 0)
														if (Record.has(tabs, payload.id)) return {...scene, tabs}
														const visitors = Array.filter(scene.visitors, visitor => visitor.id !== payload.id)
														return {
															bots: Boolean.match(Array.isReadonlyArrayEmpty(visitors), {
																onFalse: () => scene.bots,
																onTrue: () => []
															}),
															tabs,
															visitors
														}
													}
												})
											)
										})
									}
								)
								if (!admitted) {
									return Stream.fail(
										PresenceError.make({message: 'Room capacity reached or connection already joined'})
									)
								}
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
				move: Effect.fn('Presence.move')((payload, connection) =>
					Effect.gen(function* () {
						const joined = Option.getOrUndefined(MutableHashMap.get(connections, connection))
						if (joined === undefined) return yield* PresenceError.make({message: 'Join the room before moving'})
						const now = yield* Clock.currentTimeMillis
						if (now - joined.lastMove < 50) return yield* PresenceError.make({message: 'Cursor move rate exceeded'})
						joined.lastMove = now
						yield* SubscriptionRef.updateSome(room, scene =>
							pipe(
								scene.visitors,
								Array.findFirstIndex(visitor => visitor.id === joined.id && hasMeaningfulMove(visitor, payload)),
								Option.map(index => ({
									...scene,
									visitors: Array.map(scene.visitors, (visitor, position) => {
										if (position === index) return {...visitor, x: payload.x, y: payload.y}
										return visitor
									})
								}))
							)
						)
					})
				),
				recolor: Effect.fn('Presence.recolor')((payload, connection) =>
					Effect.suspend(() => {
						const joined = Option.getOrUndefined(MutableHashMap.get(connections, connection))
						if (joined === undefined) {
							return Effect.fail(PresenceError.make({message: 'Join the room before recoloring'}))
						}
						return SubscriptionRef.updateSome(room, scene => {
							if (!Array.some(scene.visitors, visitor => visitor.id === joined.id && visitor.color !== payload.color)) {
								return Option.none()
							}
							return Option.some({
								...scene,
								visitors: Array.map(scene.visitors, visitor => {
									if (visitor.id === joined.id) return {...visitor, color: payload.color}
									return visitor
								})
							})
						})
					})
				)
			})
		})
	)
}
