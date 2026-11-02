import {Array, Boolean, DateTime, Number, Option} from 'effect'

import {chartWindow, resolution} from '#services/metrics/lib/utils.ts'

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
		tick => tick.at <= window.end
	)
}

export function chartBucket(hours: number, now: number, at: number) {
	return {
		width: 80 / 60,
		x:
			(Number.clamp(Math.ceil((at - chartWindow(hours, now).start) / resolution(hours)) - 1, {
				maximum: 59,
				minimum: 0
			}) /
				60) *
			100
	}
}

export function rateScale(value: number) {
	const unit = 1024 ** Number.clamp(Math.floor(Math.log2(Number.max(1, value)) / 10), {maximum: 3, minimum: 0})
	const magnitude = 10 ** Math.floor(Math.log10(Number.max(1, value / unit)))
	const normalized = value / unit / magnitude
	const maximum =
		Option.getOrElse(
			Array.findFirst([1, 2, 5, 10], candidate => candidate >= normalized),
			() => 10
		) *
		magnitude *
		unit
	return {
		label: `${Number.round(maximum / unit, 0)}${Boolean.match(unit === 1, {onFalse: () => Boolean.match(unit === 1024, {onFalse: () => Boolean.match(unit === 1024 ** 2, {onFalse: () => 'G', onTrue: () => 'M'}), onTrue: () => 'K'}), onTrue: () => ''})}`,
		maximum
	}
}
