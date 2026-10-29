import {Array, Clock, Context, Effect, Layer, Number, Option, Record, Schedule, Schema, Stream, pipe} from 'effect'

import {Machine} from '@typeonce/effect-machine'

import {hasMeaningfulMove, removePortfolioVisitor, upsertPortfolioVisitor} from '#lib/portfolio.ts'
import type {PortfolioVisitors} from '#services/presence/schema.ts'
import {PortfolioColor, PortfolioVisitor} from '#services/presence/schema.ts'

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
			const start = yield* Clock.currentTimeMillis

			// Open tabs per visitor id: a reload or a second tab shares one cursor, and the room empties with the last tab.
			const room = Machine.make({
				branches: {left: {empty: {target: 'Empty'}, open: {update: 'Occupied'}}},
				events: Machine.events({
					Joined: {visitor: PortfolioVisitor},
					Left: {id: Schema.String},
					Moved: {
						color: PortfolioVisitor.fields.color,
						id: PortfolioVisitor.fields.id,
						x: PortfolioVisitor.fields.x,
						y: PortfolioVisitor.fields.y
					}
				}),
				root: Machine.state({
					states: {
						Empty: {},
						Occupied: {
							fields: {
								bots: pipe(PortfolioVisitor, Schema.Array),
								tabs: Schema.Record(Schema.String, Schema.Int),
								visitors: pipe(PortfolioVisitor, Schema.Array)
							}
						}
					}
				}),
				streams: {
					wander: Stream.fromEffectSchedule(
						Effect.map(Clock.currentTimeMillis, now =>
							Array.map(SERVER_BOTS, bot =>
								PortfolioVisitor.make({
									color: bot.color,
									id: bot.id,
									name: bot.name,
									x: Number.clamp({maximum: 0.995, minimum: 0.005})(
										0.5 + 0.4 * Math.sin(((now - start) / 1000) * bot.xFreq + bot.xPhase)
									),
									y: Number.clamp({maximum: 0.995, minimum: 0.005})(
										0.5 + 0.4 * Math.cos(((now - start) / 1000) * bot.yFreq + bot.yPhase)
									)
								})
							)
						),
						Schedule.spaced('55 millis')
					)
				}
			}).handle({
				initial: {target: 'Empty'},
				states: {
					Empty: {
						on: {
							Joined: {
								data: transition => ({
									bots: [],
									tabs: {[transition.event.visitor.id]: 1},
									visitors: [transition.event.visitor]
								}),
								target: 'Occupied'
							}
						}
					},
					// The bots wander only while someone is watching, and leave with the last visitor so the next one sees no jump.
					Occupied: {
						invoke: {
							onDone: {none: true},
							onElement: {data: transition => ({...transition.state, bots: transition.element}), update: 'Occupied'},
							src: 'wander'
						},
						on: {
							Joined: {
								data: transition => ({
									...transition.state,
									tabs: {
										...transition.state.tabs,
										[transition.event.visitor.id]:
											Option.getOrElse(Record.get(transition.state.tabs, transition.event.visitor.id), () => 0) + 1
									},
									visitors: upsertPortfolioVisitor(transition.state.visitors, transition.event.visitor)
								}),
								update: 'Occupied'
							},
							Left: {
								branches: 'left',
								resolve: transition => {
									const open = Option.getOrElse(Record.get(transition.state.tabs, transition.event.id), () => 1) - 1
									if (open > 0) {
										return transition.select.open({
											data: {...transition.state, tabs: {...transition.state.tabs, [transition.event.id]: open}}
										})
									}
									const tabs = Record.remove(transition.state.tabs, transition.event.id)
									if (Record.isEmptyRecord(tabs)) return transition.select.empty()
									return transition.select.open({
										data: {
											...transition.state,
											tabs,
											visitors: removePortfolioVisitor(transition.state.visitors, transition.event.id)
										}
									})
								}
							},
							Moved: {
								data: transition => ({
									...transition.state,
									visitors: Array.map(transition.state.visitors, visitor => {
										if (visitor.id !== transition.event.id) return visitor
										return {...visitor, color: transition.event.color, x: transition.event.x, y: transition.event.y}
									})
								}),
								// A twitch below the threshold reaches nobody.
								guard: transition =>
									Array.some(
										transition.state.visitors,
										visitor =>
											visitor.id === transition.event.id &&
											(visitor.color !== transition.event.color || hasMeaningfulMove(visitor, transition.event))
									),
								update: 'Occupied'
							}
						}
					}
				}
			})
			const ref = yield* Machine.start(room)
			// The room stops only with the server, when a late cursor no longer matters.
			function send(event: Parameters<typeof ref.send>[0]) {
				return Effect.ignore(ref.send(event), {log: 'Warn', message: 'The presence room has stopped'})
			}

			return Presence.of({
				join: payload =>
					Stream.unwrap(
						Effect.gen(function* () {
							yield* Effect.logInfo('Portfolio client connected')
							yield* Effect.acquireRelease(
								send({_tag: 'Joined', visitor: PortfolioVisitor.make({...payload, x: 0.5, y: 0.5})}),
								() => send({_tag: 'Left', id: payload.id})
							)

							// A slow page skips to the latest positions instead of queueing every step.
							return pipe(
								ref.changes,
								Stream.map(snapshot =>
									Option.match(room.root.get(snapshot.state, 'Occupied'), {
										onNone: () => [],
										onSome: occupied => [...occupied.visitors, ...occupied.bots]
									})
								),
								Stream.buffer({capacity: 1, strategy: 'sliding'})
							)
						})
					),
				move: payload => send({_tag: 'Moved', ...payload})
			})
		})
	)
}
