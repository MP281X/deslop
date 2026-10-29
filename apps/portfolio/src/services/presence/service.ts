import {
	Array,
	Clock,
	Context,
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

import {Machine} from 'effect-machine'

import {hasMeaningfulMove, removePortfolioVisitor, upsertPortfolioVisitor} from '#lib/portfolio.ts'
import type {PortfolioVisitors} from '#services/presence/schema.ts'
import {PortfolioColor, PortfolioVisitor, Room, RoomEvent} from '#services/presence/schema.ts'

const SERVER_BOTS = [
	{
		color: PortfolioColor.literals[3],
		id: 'server-alpha',
		name: 'server-alpha',
		xFreq: 0.47,
		xPhase: 0,
		yFreq: 0.71,
		yPhase: 0
	},
	{
		color: PortfolioColor.literals[17],
		id: 'server-beta',
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
		readonly join: (payload: Pick<PortfolioVisitor, 'color' | 'id' | 'name'>) => Stream.Stream<PortfolioVisitors>
		readonly move: (payload: Pick<PortfolioVisitor, 'color' | 'id' | 'x' | 'y'>) => Effect.Effect<void>
	}
>()('@deslop/portfolio/services/presence/service/Presence') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const visitors = yield* SubscriptionRef.make<PortfolioVisitors>([])

			const start = yield* Clock.currentTimeMillis
			const moveBots = Effect.gen(function* () {
				const t = ((yield* Clock.currentTimeMillis) - start) / 1000
				yield* SubscriptionRef.update(visitors, current =>
					Array.reduce(SERVER_BOTS, current, (moved, bot) =>
						upsertPortfolioVisitor(
							moved,
							PortfolioVisitor.make({
								color: bot.color,
								id: bot.id,
								name: bot.name,
								x: Number.clamp({maximum: 0.995, minimum: 0.005})(0.5 + 0.4 * Math.sin(t * bot.xFreq + bot.xPhase)),
								y: Number.clamp({maximum: 0.995, minimum: 0.005})(0.5 + 0.4 * Math.cos(t * bot.yFreq + bot.yPhase))
							})
						)
					)
				)
			})

			const room = Machine.make({event: RoomEvent, initial: Room.Empty, state: Room})
				.on(Room.Empty, RoomEvent.Joined, transition =>
					Effect.as(
						SubscriptionRef.update(visitors, current => upsertPortfolioVisitor(current, transition.event.visitor)),
						Room.Occupied({tabs: {[transition.event.visitor.id]: 1}})
					)
				)
				.on(Room.Occupied, RoomEvent.Joined, transition =>
					Effect.as(
						SubscriptionRef.update(visitors, current => upsertPortfolioVisitor(current, transition.event.visitor)),
						Room.Occupied({
							tabs: {
								...transition.state.tabs,
								[transition.event.visitor.id]: (transition.state.tabs[transition.event.visitor.id] ?? 0) + 1
							}
						})
					)
				)
				.on(Room.Occupied, RoomEvent.Left, transition => {
					const open = (transition.state.tabs[transition.event.id] ?? 1) - 1
					if (open > 0) return Room.Occupied({tabs: {...transition.state.tabs, [transition.event.id]: open}})
					const tabs = Record.remove(transition.state.tabs, transition.event.id)
					const left = SubscriptionRef.update(visitors, current => removePortfolioVisitor(current, transition.event.id))
					if (Record.isEmptyRecord(tabs)) return Effect.as(left, Room.Empty)
					return Effect.as(left, Room.Occupied({tabs}))
				})
				// The bots wander only while someone is watching, and leave with the last visitor so the next one sees no jump.
				.spawn(
					Room.Occupied,
					() =>
						Effect.gen(function* () {
							yield* Effect.addFinalizer(() =>
								SubscriptionRef.update(visitors, current =>
									Array.filter(current, visitor => !Array.some(SERVER_BOTS, bot => bot.id === visitor.id))
								)
							)
							yield* Effect.repeat(moveBots, Schedule.spaced('55 millis'))
						}),
					{name: 'wander'}
				)
			const actor = yield* Machine.scoped(Machine.spawn(room))
			yield* actor.start

			return Presence.of({
				join: payload =>
					Stream.unwrap(
						Effect.gen(function* () {
							yield* Effect.logInfo('Portfolio client connected')
							yield* Effect.acquireRelease(
								actor.call(RoomEvent.Joined({visitor: PortfolioVisitor.make({...payload, x: 0.5, y: 0.5})})),
								() => actor.call(RoomEvent.Left({id: payload.id}))
							)

							// A slow page skips to the latest positions instead of queueing every step.
							return Stream.buffer(SubscriptionRef.changes(visitors), {capacity: 1, strategy: 'sliding'})
						})
					),
				move: payload =>
					SubscriptionRef.updateSome(visitors, current =>
						pipe(
							Array.findFirst(current, visitor => visitor.id === payload.id),
							Option.filter(found => found.color !== payload.color || hasMeaningfulMove(found, payload)),
							Option.map(found => upsertPortfolioVisitor(current, PortfolioVisitor.make({...found, ...payload})))
						)
					)
			})
		})
	)
}
