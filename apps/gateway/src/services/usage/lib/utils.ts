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
