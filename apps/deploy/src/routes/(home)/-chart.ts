import {Array, DateTime} from 'effect'

import {chartWindow} from '#services/metrics/lib/utils.ts'
import type {HistoryQuery} from '#services/metrics/schema.ts'

// Within an hour, ticks every 15 seconds, 2 minutes or 15 minutes from the epoch, which land on round local times wherever the step divides the zone's offset: everywhere but 2 minutes in zones 45 minutes off the hour.
const STEPS: Record<number, number> = {1: 15_000, 10: 120_000, 60: 900_000}

export const RANGES = [
	{label: '1m', minutes: 1, name: '1 minute'},
	{label: '10m', minutes: 10, name: '10 minutes'},
	{label: '1h', minutes: 60, name: '1 hour'},
	{label: '24h', minutes: 1440, name: '24 hours'},
	{label: '7d', minutes: 10_080, name: '7 days'}
] as const satisfies readonly {label: string; minutes: HistoryQuery['minutes']; name: string}[]

export function chartTicks(minutes: number, now: number) {
	const window = chartWindow(minutes, now)
	const start = DateTime.makeZonedUnsafe(window.start, {timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone})
	const step = STEPS[minutes]
	function tick(index: number) {
		if (step !== undefined) return (Math.floor(window.start / step) + 1 + index) * step
		if (minutes === 1440) {
			const first = DateTime.setParts(start, {
				hour: Math.floor(DateTime.toParts(start).hour / 6) * 6 + 6,
				millisecond: 0,
				minute: 0,
				second: 0
			})
			return DateTime.toEpochMillis(DateTime.setParts(first, {hour: DateTime.toParts(first).hour + index * 6}))
		}
		return DateTime.toEpochMillis(DateTime.add(DateTime.startOf(start, 'day'), {days: index + 1}))
	}
	return Array.filter(
		Array.makeBy(8, index => {
			const at = tick(index)
			return {
				at,
				label: minutes !== 10_080 || index % 2 === 0,
				x: ((at - window.start) / (window.end - window.start)) * 100
			}
		}),
		value => value.at <= now
	)
}
