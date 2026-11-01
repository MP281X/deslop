import {Array, Boolean, Effect, Number, Option} from 'effect'

import {ROUND} from '#services/game/lib/utils.ts'
import type {Entry, Experience} from '#services/game/schema.ts'

export type Readers<E> = {
	history: (before: Option.Option<number>, at: number) => Effect.Effect<readonly Experience[], E>
	thread: (team: number, before: Option.Option<number>) => Effect.Effect<readonly Entry[], E>
}

type FeedItem = {kind: 'event'; value: Experience} | {kind: 'core'; value: Entry}

// API pages stop at 100 events or 20 rounds; complete their shared boundary tick before advancing.
export const readFeed = Effect.fnUntraced(function* <E>(readers: Readers<E>, teams: readonly number[], at: number) {
	const rounds = Array.flatten(
		yield* Effect.forEach(
			teams,
			team =>
				readers.thread(
					team,
					Option.map(
						Option.liftPredicate(at, tick => tick >= 0),
						tick => Math.floor(tick / ROUND) + 2
					)
				),
			{concurrency: 'unbounded'}
		)
	)
	const events = yield* readers.history(Option.none(), at)
	const full =
		events.length === 100 || Array.some(teams, team => Array.countBy(rounds, entry => entry.team === team) === 20)
	const boundary = Array.reduce(
		[
			Boolean.match(events.length === 100, {onFalse: () => 0, onTrue: () => events[0]?.tick ?? 0}),
			...Array.map(teams, team => {
				const own = Array.filter(rounds, entry => entry.team === team)
				if (own.length < 20) return 0
				return own[0]?.tick ?? 0
			})
		],
		0,
		(highest, tick) => Number.max(highest, tick)
	)
	const state = {
		cursor: events[0]?.id ?? 0,
		events: [...events],
		more: events.length === 100 && events[0]?.tick === boundary
	}
	while (state.more) {
		const older = yield* readers.history(Option.some(state.cursor), at)
		state.events = [...older, ...state.events]
		state.cursor = older[0]?.id ?? 0
		state.more = older.length === 100 && older[0]?.tick === boundary
	}
	const entries: FeedItem[] = [
		...Array.map(state.events, value => ({kind: 'event' as const, value})),
		...Array.map(rounds, value => ({kind: 'core' as const, value}))
	]
	return {
		before: Boolean.match(full && boundary > 0, {onFalse: () => -1, onTrue: () => boundary - 1}),
		entries: Array.sortWith(
			Array.filter(entries, entry => entry.value.tick >= boundary && (at < 0 || entry.value.tick <= at)),
			(entry: FeedItem) => entry.value.tick,
			Number.Order
		)
	}
})
