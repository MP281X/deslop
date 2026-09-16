import {
	Array,
	Clock,
	Duration,
	Effect,
	HashMap,
	Number,
	Option,
	Ref,
	Schedule,
	Semaphore,
	Stream,
	SubscriptionRef,
	Tuple,
	pipe
} from 'effect'

import {appendPortfolioTrail, portfolioPalette, removePortfolioVisitor, upsertPortfolioVisitor} from '#lib/portfolio.ts'
import {PortfolioState, PortfolioTrail, PortfolioVisitor, RpcContracts} from '#rpcs/contracts.ts'

const SERVER_BOTS = [
	{
		color: portfolioPalette[3],
		id: 'server-alpha',
		name: 'server-alpha',
		xFreq: 0.47,
		xPhase: 0,
		yFreq: 0.71,
		yPhase: 0
	},
	{
		color: portfolioPalette[17],
		id: 'server-beta',
		name: 'server-beta',
		xFreq: 0.83,
		xPhase: Math.PI,
		yFreq: 0.53,
		yPhase: Math.PI / 2
	}
] as const

function botPosition(bot: (typeof SERVER_BOTS)[number], t: number) {
	return {
		x: Number.clamp({maximum: 0.995, minimum: 0.005})(0.5 + 0.4 * Math.sin(t * bot.xFreq + bot.xPhase)),
		y: Number.clamp({maximum: 0.995, minimum: 0.005})(0.5 + 0.4 * Math.cos(t * bot.yFreq + bot.yPhase))
	}
}

function hasMeaningfulMove(current: {x: number; y: number}, next: {x: number; y: number}) {
	const deltaX = next.x - current.x
	const deltaY = next.y - current.y

	return deltaX * deltaX + deltaY * deltaY >= 0.0025 * 0.0025
}

function findVisitor(visitors: PortfolioState['visitors'], id: string) {
	return pipe(
		visitors,
		Array.findFirst(visitor => visitor.id === id),
		Option.getOrUndefined
	)
}

function moveVisitor(state: PortfolioState, visitor: PortfolioVisitor) {
	const trail = PortfolioTrail.make({color: visitor.color, visitorId: visitor.id, x: visitor.x, y: visitor.y})

	return PortfolioState.make({
		trails: appendPortfolioTrail(state.trails, trail),
		visitors: upsertPortfolioVisitor(state.visitors, visitor)
	})
}

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const state = yield* SubscriptionRef.make(PortfolioState.make({}))
		const connections = yield* Ref.make(HashMap.empty<string, number>())
		const lifecycle = yield* Semaphore.make(1)

		const start = yield* Clock.currentTimeMillis
		for (const bot of SERVER_BOTS) {
			yield* Effect.forkScoped(
				Effect.repeat(
					Effect.gen(function* () {
						const pos = botPosition(bot, ((yield* Clock.currentTimeMillis) - start) / 1000)
						const visitor = PortfolioVisitor.make({color: bot.color, id: bot.id, name: bot.name, x: pos.x, y: pos.y})
						yield* SubscriptionRef.modifySome(state, currentState => {
							const currentBot = findVisitor(currentState.visitors, bot.id)
							if (currentBot && !hasMeaningfulMove(currentBot, pos)) return Tuple.make(undefined, Option.none())

							return Tuple.make(undefined, Option.some(moveVisitor(currentState, visitor)))
						})
					}),
					Schedule.spaced(Duration.millis(55))
				)
			)
		}

		return RpcContracts.of({
			'portfolio.join': payload =>
				Stream.unwrap(
					Effect.gen(function* () {
						yield* Effect.logInfo('Portfolio client connected')
						const visitor = PortfolioVisitor.make({
							color: payload.color,
							id: payload.id,
							name: payload.name,
							x: 0.5,
							y: 0.5
						})
						yield* Effect.acquireRelease(
							lifecycle.withPermit(
								Effect.gen(function* () {
									yield* Ref.update(
										connections,
										HashMap.modifyAt(payload.id, count =>
											Option.some(
												pipe(
													count,
													Option.getOrElse(() => 0)
												) + 1
											)
										)
									)
									yield* SubscriptionRef.update(state, currentState =>
										PortfolioState.make({
											trails: currentState.trails,
											visitors: upsertPortfolioVisitor(currentState.visitors, visitor)
										})
									)
								})
							),
							() =>
								lifecycle.withPermit(
									Effect.gen(function* () {
										const remove = yield* Ref.modify(connections, current => {
											const count = pipe(
												HashMap.get(current, payload.id),
												Option.getOrElse(() => 0)
											)
											return count <= 1
												? ([true, HashMap.remove(current, payload.id)] as const)
												: ([false, HashMap.set(current, payload.id, count - 1)] as const)
										})
										if (!remove) return

										yield* SubscriptionRef.update(state, latestState => {
											const visitors = removePortfolioVisitor(latestState.visitors, payload.id)
											return visitors === latestState.visitors
												? latestState
												: PortfolioState.make({trails: latestState.trails, visitors})
										})
									})
								)
						)

						return SubscriptionRef.changes(state)
					})
				),
			'portfolio.move': Effect.fn('PortfolioRpc.move')(function* (payload) {
				yield* SubscriptionRef.modifySome(state, currentState => {
					const found = findVisitor(currentState.visitors, payload.id)
					if (!found || (found.color === payload.color && !hasMeaningfulMove(found, payload))) {
						return Tuple.make(undefined, Option.none())
					}

					const nextVisitor = PortfolioVisitor.make({
						color: payload.color,
						id: payload.id,
						name: found.name,
						x: payload.x,
						y: payload.y
					})
					return Tuple.make(undefined, Option.some(moveVisitor(currentState, nextVisitor)))
				})
			})
		})
	})
)
