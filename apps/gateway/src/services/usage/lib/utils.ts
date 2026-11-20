import {DateTime, Effect, Schedule, Stream, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'

import {liveRead} from '@deslop/runtime/shared/live-read'
import type {TimeFrame} from '@deslop/runtime/shared/time'

import {type UsageRange, timeFrameRange} from '#services/usage/schema.ts'

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

// One delete statement removes at most this many rows, so a long-idle owner or server never holds the database for long.
export const EXPIRY_BATCH = 5000

// Calls are kept thirty days: when an owner or server makes a counted call, its own older calls go, batch after batch. A dormant one's history stays.
export function expireCalls<E, R>(expire: Effect.Effect<readonly unknown[], E, R>) {
	return pipe(
		expire,
		Effect.repeat({while: rows => rows.length === EXPIRY_BATCH}),
		Effect.catchCause(cause => Effect.logWarning('Old calls could not be deleted', cause))
	)
}
