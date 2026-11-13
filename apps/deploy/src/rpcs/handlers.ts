import {Cache, Duration, Effect, Number, Schedule, Scope, Stream, pipe} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Fleet} from '#services/fleet/service.ts'
import {resolution} from '#services/metrics/lib/utils.ts'
import {HistoryQuery} from '#services/metrics/schema.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const fleet = yield* Fleet
		// A cache lookup inherits its caller's scope; shared sources belong to this layer, not the first RPC.
		const scope = yield* Effect.scope
		const inventory = yield* pipe(Stream.fromEffect(fleet.local), pipelineSubject584 => Stream.concat(pipelineSubject584, Stream.fromEffectSchedule(fleet.snapshot, Schedule.spaced('5 seconds'))), pipelineSubject567 => Stream.share(pipelineSubject567, {capacity: 1, replay: 1, strategy: 'sliding'}))
		// Viewers share one range sampler; the source stops when its last viewer leaves.
		const metrics = yield* Cache.make({
			capacity: HistoryQuery.fields.minutes.literals.length,
			lookup: (minutes: HistoryQuery['minutes']) => {
				const query = {minutes}
				return pipe(Stream.fromEffect(fleet.current(query)), pipelineSubject1183 => Stream.concat(pipelineSubject1183, Stream.fromEffect(fleet.metrics(query))), pipelineSubject1161 => Stream.concat(pipelineSubject1161, Stream.merge(
								Stream.fromEffectSchedule(
									fleet.current(query),
									Schedule.spaced(Duration.millis(Number.min(resolution(minutes), 30_000)))
								),
								Stream.drain(
									Stream.fromEffectSchedule(
										fleet.metrics(query),
										Schedule.spaced(
											Duration.millis(Number.clamp(resolution(minutes), {maximum: 30_000, minimum: 5000}))
										)
									)
								)
							)), pipelineSubject1141 => Stream.share(pipelineSubject1141, {capacity: 1, replay: 1, strategy: 'sliding'}), pipelineSubject1113 => Effect.provideService(pipelineSubject1113, Scope.Scope, scope))
			}
		})
		return RpcContracts.of({
			'exposures.expose': fleet.expose,
			'exposures.hide': fleet.hide,
			'inventory.run': fleet.run,
			'inventory.snapshot': () => fleet.local,
			'inventory.watch': () => inventory,
			'metrics.history': fleet.history,
			// Cached history at once, then every worker's fresh one; after that a slot of the range as each fills, at most every 30 seconds, while the other workers refresh beside it, at most every 5 seconds, so a sleeping one never holds back this one's seconds.
			'metrics.watch': query => Stream.unwrap(Cache.get(metrics, query.minutes))
		})
	})
)
