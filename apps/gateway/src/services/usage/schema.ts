import {DateTime, Duration, Schema} from 'effect'

import {DateTimeUtcFromFiniteMillis, DurationFromFiniteMillis, timeFrameDuration} from '@deslop/runtime/shared/time'
import type {TimeFrame} from '@deslop/runtime/shared/time'

export type UsageRange = typeof UsageRange.Type
export const UsageRange = Schema.Struct({
	count: Schema.Finite,
	from: DateTimeUtcFromFiniteMillis,
	size: DurationFromFiniteMillis,
	to: DateTimeUtcFromFiniteMillis
})

// Deploy's source spacing, limited to our finest stored unit for ten minutes.
const BUCKETS: Record<TimeFrame, Duration.Duration> = {
	'1h': Duration.minutes(1),
	'7d': Duration.hours(1),
	'10m': Duration.minutes(1),
	'24h': Duration.minutes(15)
}

export function timeFrameRange(frame: TimeFrame, now: DateTime.Utc) {
	const duration = timeFrameDuration(frame)
	const size = BUCKETS[frame]
	const millis = Duration.toMillis(size)
	const to = DateTime.mapEpochMillis(now, value => Math.floor(value / millis) * millis + millis)
	return {
		count: Duration.toMillis(duration) / millis,
		from: DateTime.subtractDuration(to, duration),
		size,
		to
	} satisfies UsageRange
}
