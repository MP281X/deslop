import {DateTime, Duration, Effect, Schedule, Stream, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'

import {liveRead} from '@deslop/runtime/shared/live-read'
import {type TimeFrame, timeFrameDuration} from '@deslop/runtime/shared/time'

import type {UsageRange} from '#contracts'

// Report spacing; the home charts combine these into at most sixty slots.
const BUCKETS: Record<TimeFrame, Duration.Duration> = {
	'1h': Duration.minutes(1),
	'7d': Duration.hours(1),
	'10m': Duration.minutes(1),
	'24h': Duration.minutes(15),
	'30d': Duration.hours(12)
}

function timeFrameRange(frame: TimeFrame, now: DateTime.Utc) {
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

// Read immediately and reopen the frame at each UTC minute boundary; invalidations trigger reads within that frame.
export function usageWindow<A, E, R>(
	frame: TimeFrame,
	keys: Reactivity.KeysInput,
	read: (range: UsageRange) => Effect.Effect<A, E, R>
) {
	return pipe(
		Stream.fromEffectSchedule(Effect.void, Schedule.cron('* * * * *', 'UTC')),
		// Only parsing the fixed cron expressions can fail here, not reading a report below.
		Stream.orDie,
		Stream.switchMap(() =>
			Stream.unwrap(
				Effect.gen(function* () {
					const range = timeFrameRange(frame, yield* DateTime.now)
					// Keep one pending invalidation during each read and its one-second pause; emit only changed range/report values.
					return pipe(
						Reactivity.stream(Effect.void, keys),
						liveRead(read(range)),
						Stream.map(report => ({range, report})),
						Stream.changes
					)
				})
			)
		)
	)
}
