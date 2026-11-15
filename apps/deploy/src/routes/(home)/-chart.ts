import {Array, DateTime, Duration, pipe} from 'effect'

import {TimeFrame, timeFrameDuration} from '@deslop/runtime/shared/time'

import {chartWindow} from '#services/metrics/lib/utils.ts'

// Within an hour, ticks every 2 or 15 minutes from the epoch, which land on round local times wherever the step divides the zone's offset: everywhere but 2 minutes in zones 45 minutes off the hour.
const STEPS: Record<number, number> = {10: 120_000, 60: 900_000}

export const RANGES = Array.map(TimeFrame.literals, frame => ({label: frame, value: timeFrameDuration(frame)}))

export function chartTicks(range: Duration.Duration, now: DateTime.Utc) {
	const minutes = Duration.toMinutes(range)
	const window = chartWindow(range, now)
	const start = DateTime.makeZonedUnsafe(window.start, {timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone})
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
		return DateTime.toEpochMillis(pipe(start, DateTime.startOf('day'), DateTime.add({days: index + 1})))
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
