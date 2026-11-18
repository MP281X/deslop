import {Array, DateTime, Duration, pipe} from 'effect'

import {TimeFrame, timeFrameDuration} from '@deslop/runtime/shared/time'

import {chartWindow} from '#services/metrics/lib/utils.ts'

// Within an hour, ticks every 2 or 15 minutes from the epoch, which land on round local times wherever the step divides the zone's offset: everywhere but 2 minutes in zones 45 minutes off the hour.
const STEPS: Record<number, number> = {10: 120_000, 60: 900_000}

// A week ticks every local midnight and a month every seventh, so eight ticks always reach the window's end.
const DAYS: Record<number, number> = {10_080: 1, 43_200: 7}

export const RANGES = Array.map(TimeFrame.literals, frame => ({label: frame, value: timeFrameDuration(frame)}))

// A range of a week or more labels its ticks with dates; a shorter one with clock times.
export function datedRange(range: Duration.Duration) {
	return Duration.toMinutes(range) >= 10_080
}

export function chartTicks(range: Duration.Duration, now: DateTime.Utc, timeZone: DateTime.TimeZone) {
	const minutes = Duration.toMinutes(range)
	const window = chartWindow(range, now)
	const start = DateTime.makeZonedUnsafe(window.start, {timeZone})
	const step = STEPS[minutes]
	function tick(index: number) {
		if (step !== undefined) return (Math.floor(DateTime.toEpochMillis(window.start) / step) + 1 + index) * step
		if (minutes === 1440) {
			const first = DateTime.setParts(start, {
				hour: Math.floor(DateTime.toParts(start).hour / 6) * 6 + 6,
				millisecond: 0,
				minute: 0,
				second: 0
			})
			return DateTime.toEpochMillis(DateTime.setParts(first, {hour: DateTime.toParts(first).hour + index * 6}))
		}
		return DateTime.toEpochMillis(
			pipe(start, DateTime.startOf('day'), DateTime.add({days: (index + 1) * (DAYS[minutes] ?? 1)}))
		)
	}
	return pipe(
		8,
		Array.makeBy(index => {
			const at = tick(index)
			return {
				at,
				label: minutes !== 10_080 || index % 2 === 0,
				x: ((at - DateTime.toEpochMillis(window.start)) / Duration.toMillis(range)) * 100
			}
		}),
		Array.filter(value => value.at <= DateTime.toEpochMillis(now))
	)
}
