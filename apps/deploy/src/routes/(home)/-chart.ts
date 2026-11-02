import {Array, DateTime} from 'effect'

import {chartWindow} from '#services/metrics/lib/utils.ts'

export function chartTicks(hours: number, now: number) {
	const window = chartWindow(hours, now)
	const start = DateTime.makeZonedUnsafe(window.start, {timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone})
	const parts = DateTime.toParts(start)
	function firstTick() {
		if (hours === 1) {
			return DateTime.setParts(start, {millisecond: 0, minute: Math.floor(parts.minute / 15) * 15 + 15, second: 0})
		}
		if (hours === 24) {
			return DateTime.setParts(start, {hour: Math.floor(parts.hour / 6) * 6 + 6, millisecond: 0, minute: 0, second: 0})
		}
		return DateTime.add(DateTime.startOf(start, 'day'), {days: 1})
	}
	const first = firstTick()
	return Array.filter(
		Array.makeBy(8, index => {
			function advance() {
				if (hours === 1) return DateTime.add(first, {minutes: index * 15})
				if (hours === 24) return DateTime.setParts(first, {hour: DateTime.toParts(first).hour + index * 6})
				return DateTime.add(first, {days: index})
			}
			const at = DateTime.toEpochMillis(advance())
			return {at, label: hours !== 168 || index % 2 === 0, x: ((at - window.start) / (window.end - window.start)) * 100}
		}),
		tick => tick.at <= now
	)
}
