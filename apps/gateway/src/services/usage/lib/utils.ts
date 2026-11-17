import {DateTime, Duration, Effect, Schedule, Stream, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'

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
						Stream.buffer({capacity: 1, strategy: 'sliding'}),
						Stream.mapEffect(() => read(range)),
						Stream.flatMap(report =>
							Stream.concat(Stream.succeed({range, report}), Stream.fromEffectDrain(Effect.sleep(Duration.seconds(1))))
						),
						Stream.changes
					)
				})
			)
		)
	)
}
