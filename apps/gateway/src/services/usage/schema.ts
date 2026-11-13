import {Boolean, DateTime, Duration, Schema, pipe} from 'effect'

import {DateTimeUtcFromFiniteMillis, DurationFromFiniteMillis} from '@deslop/runtime/shared/time'

// The page's period and the buckets it covers, ending with the current one: hours for a day, UTC days otherwise.
export type Period = typeof Period.Type
export const Period = Schema.Literals(['24h', '7d', '30d'])
export type UsageRange = typeof UsageRange.Type
export const UsageRange = Schema.Struct({
	count: Schema.Finite,
	from: DateTimeUtcFromFiniteMillis,
	size: DurationFromFiniteMillis,
	to: DateTimeUtcFromFiniteMillis
})

export function periodRange(period: Period, now: DateTime.Utc) {
	const size = Boolean.match(period === '24h', {onFalse: () => Duration.days(1), onTrue: () => Duration.hours(1)})
	const count = {'7d': 7, '24h': 24, '30d': 30}[period]
	const to = pipe(
		now,
		DateTime.startOf(Boolean.match(period === '24h', {onFalse: () => 'day' as const, onTrue: () => 'hour' as const})),
		DateTime.addDuration(size)
	)
	return {count, from: DateTime.subtractDuration(to, Duration.times(size, count)), size, to} satisfies UsageRange
}
