import {Array, DateTime, Number, Option, Order} from 'effect'

import type {PullRequest} from '#services/changes/schema.ts'

export type Strip = {readonly end: number; readonly pr: PullRequest; readonly start: number}

function millisOf(iso: string) {
	return DateTime.toEpochMillis(DateTime.makeUnsafe(iso))
}

export function stripsOf(pullRequests: readonly PullRequest[], now: number) {
	return Array.sort(
		Array.map(pullRequests, pr => ({
			end: Option.match(Option.fromUndefinedOr(pr.mergedAt), {onNone: () => now, onSome: millisOf}),
			pr,
			start: millisOf(pr.createdAt)
		})),
		Order.combine(
			Order.mapInput(Order.Number, (strip: Strip) => strip.start),
			Order.mapInput(Order.Number, (strip: Strip) => strip.pr.number)
		)
	)
}

export function spanOf(strips: readonly Strip[], now: number) {
	const start = Array.match(
		Array.map(strips, strip => strip.start),
		{onEmpty: () => now, onNonEmpty: starts => Array.min(starts, Order.Number)}
	)
	return {
		end: Number.max(
			Array.max(
				Array.append(
					Array.map(strips, strip => Number.max(strip.end, now)),
					now
				),
				Order.Number
			),
			start + 60 * 60_000
		),
		start
	}
}

export function ticksOf(start: number, end: number, count: number) {
	if (count <= 0) return []
	if (count === 1) return [start]
	return Array.append(
		Array.makeBy(count - 1, index => start + ((end - start) * index) / (count - 1)),
		end
	)
}
