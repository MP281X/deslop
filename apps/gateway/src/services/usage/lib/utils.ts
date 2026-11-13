import {Boolean, Clock, Effect, Schedule, Stream, pipe} from 'effect'

import {type Period, type UsageRange, periodRange} from '#services/usage/schema.ts'

// A period's report as it changes, in a window that reopens at every bucket boundary; `watch` reads the window again after each recorded call.
export function usageWindow<A, E, R>(period: Period, watch: (range: UsageRange) => Stream.Stream<A, E, R>) {
	return pipe(
		Stream.fromEffectSchedule(
			Effect.void,
			Schedule.cron(Boolean.match(period === '24h', {onFalse: () => '0 0 * * *', onTrue: () => '0 * * * *'}), 'UTC')
		),
		// Only parsing the fixed cron expressions can fail here, not reading a report below.
		Stream.orDie,
		Stream.switchMap(() =>
			Stream.unwrap(
				Effect.gen(function* () {
					const range = periodRange(period, yield* Clock.currentTimeMillis)
					// A burst of calls coalesces into one report a second, always the newest; a report that did not change is not sent again.
					return pipe(
						watch(range),
						Stream.changes,
						Stream.buffer({capacity: 1, strategy: 'sliding'}),
						Stream.flatMap(report =>
							Stream.concat(Stream.succeed({range, report}), Stream.drain(Stream.fromEffect(Effect.sleep('1 second'))))
						)
					)
				})
			)
		)
	)
}
