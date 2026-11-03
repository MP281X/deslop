import {Duration, Effect, Number, Schedule, Stream} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Fleet} from '#services/fleet/service.ts'
import {resolution} from '#services/metrics/lib/utils.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const fleet = yield* Fleet
		return RpcContracts.of({
			'deploy.expose': fleet.expose,
			'deploy.hide': fleet.hide,
			'deploy.history': fleet.history,
			'deploy.inventory': () =>
				Stream.concat(
					Stream.fromEffect(fleet.local),
					Stream.fromEffectSchedule(fleet.snapshot, Schedule.spaced('5 seconds'))
				),
			// Cached history at once, then every worker's fresh one; after that a slot of the range as each fills, at most every 30 seconds, while the other workers refresh beside it, at most every 5 seconds, so a sleeping one never holds back this one's seconds.
			'deploy.metrics': query =>
				Stream.concat(
					Stream.concat(Stream.fromEffect(fleet.current(query)), Stream.fromEffect(fleet.metrics(query))),
					Stream.merge(
						Stream.fromEffectSchedule(
							fleet.current(query),
							Schedule.spaced(Duration.millis(Number.min(resolution(query.minutes), 30_000)))
						),
						Stream.drain(
							Stream.fromEffectSchedule(
								fleet.metrics(query),
								Schedule.spaced(
									Duration.millis(Number.clamp(resolution(query.minutes), {maximum: 30_000, minimum: 5000}))
								)
							)
						)
					)
				),
			'deploy.run': fleet.run,
			'deploy.snapshot': () => fleet.local
		})
	})
)
