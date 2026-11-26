import {Boolean, Cache, DateTime, Duration, Effect, Record, Schedule, Scope, Stream, pipe} from 'effect'

import {MetricsRpcs} from '#contracts'
import type {HistoryQuery} from '#contracts'

import {Inventory} from '#server/inventory/service.ts'
import {SERIES, resolution} from '#server/metrics/lib/history.ts'
import {Metrics} from '#server/metrics/service.ts'

export const metricsHandlers = MetricsRpcs.toLayer(
	Effect.gen(function* () {
		const inventory = yield* Inventory
		const metrics = yield* Metrics
		// A cache lookup inherits its caller's scope; shared sources belong to this layer, not the first RPC.
		const scope = yield* Effect.scope
		// Viewers share one range sampler; the source stops when its last viewer leaves.
		const histories = yield* Cache.make({
			capacity: Record.size(SERIES),
			lookup: Effect.fnUntraced(function* (minutes: HistoryQuery['minutes']) {
				return yield* pipe(
					Stream.fromEffectSchedule(
						metrics.read({minutes}),
						pipe(
							minutes,
							Duration.equals(Duration.hours(1)),
							Boolean.match({
								onFalse: () => Duration.min(resolution(minutes), Duration.seconds(30)),
								onTrue: () => Duration.seconds(5)
							}),
							Schedule.spaced
						)
					),
					Stream.share({capacity: 1, replay: 1, strategy: 'sliding'}),
					Effect.provideService(Scope.Scope, scope)
				)
			})
		})
		return MetricsRpcs.of({
			'metrics.app': input =>
				Stream.fromEffectSchedule(
					Effect.gen(function* () {
						const time = yield* DateTime.now
						const hour = yield* Effect.all(
							{processes: metrics.processHistory(input, time), restarts: inventory.restarts(input, time)},
							{concurrency: 'unbounded'}
						)
						return {...hour, time}
					}),
					Schedule.spaced(Duration.seconds(5))
				),
			'metrics.watch': query => Stream.unwrap(Cache.get(histories, query.minutes))
		})
	})
)
