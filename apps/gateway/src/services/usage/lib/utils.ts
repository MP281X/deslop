import {Boolean, Clock, Effect, Schedule, Stream, pipe} from 'effect'

import {type Period, type UsageRange, periodRange} from '#services/usage/schema.ts'

// A period's report and its changes in a window that reopens at every bucket boundary; `changed` starts with its current value.
export function usageWindow<A, E, R>(
	period: Period,
	changed: Stream.Stream<void, E, R>,
	read: (range: UsageRange) => Effect.Effect<A, E, R>
) {
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
					return Stream.map(
						// A burst of changes coalesces into one report a second; the window is read again with each.
						pipe(
							changed,
							Stream.buffer({capacity: 1, strategy: 'sliding'}),
							Stream.flatMap(() =>
								Stream.concat(Stream.fromEffect(read(range)), Stream.drain(Stream.fromEffect(Effect.sleep('1 second'))))
							)
						),
						value => ({range, report: value})
					)
				})
			)
		)
	)
}
