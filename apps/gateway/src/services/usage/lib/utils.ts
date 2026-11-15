import {DateTime, Duration, Effect, Schedule, Stream, pipe} from 'effect'

import type {TimeFrame} from '@deslop/runtime/shared/time'

import {type UsageRange, timeFrameRange} from '../schema.ts'

// Reopen the frame every minute, including idle expiry; `watch` reads it again after each recorded call.
export function usageWindow<A, E, R>(frame: TimeFrame, watch: (range: UsageRange) => Stream.Stream<A, E, R>) {
	return pipe(
		Stream.fromEffectSchedule(Effect.void, Schedule.cron('* * * * *', 'UTC')),
		// Only parsing the fixed cron expressions can fail here, not reading a report below.
		Stream.orDie,
		Stream.switchMap(() =>
			Stream.unwrap(
				Effect.gen(function* () {
					const range = timeFrameRange(frame, yield* DateTime.now)
					// A burst of calls coalesces into one report a second, always the newest; a report that did not change is not sent again.
					return pipe(
						watch(range),
						Stream.changes,
						Stream.buffer({capacity: 1, strategy: 'sliding'}),
						Stream.flatMap(report =>
							Stream.concat(Stream.succeed({range, report}), Stream.fromEffectDrain(Effect.sleep(Duration.seconds(1))))
						)
					)
				})
			)
		)
	)
}
