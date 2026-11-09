import {Boolean, Schema} from 'effect'

// The page's period and the buckets it covers, ending with the current one: hours for a day, UTC days otherwise.
export type Period = typeof Period.Type
export const Period = Schema.Literals(['24h', '7d', '30d'])
export type UsageRange = typeof UsageRange.Type
export const UsageRange = Schema.Struct({
	count: Schema.Finite,
	from: Schema.Finite,
	size: Schema.Finite,
	to: Schema.Finite
})

export function periodRange(period: Period, now: number) {
	const size = Boolean.match(period === '24h', {onFalse: () => 86_400_000, onTrue: () => 3_600_000})
	const count = {'7d': 7, '24h': 24, '30d': 30}[period]
	const to = (Math.floor(now / size) + 1) * size
	return {count, from: to - count * size, size, to} satisfies UsageRange
}
