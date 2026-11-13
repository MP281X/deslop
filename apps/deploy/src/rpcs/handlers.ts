import {Cache, Duration, Effect, Record, Schedule, Scope, Stream, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Exposures} from '#services/exposures/service.ts'
import {Fleet} from '#services/fleet/service.ts'
import {Inventory} from '#services/inventory/service.ts'
import {SERIES, resolution} from '#services/metrics/lib/utils.ts'
import type {HistoryQuery} from '#services/metrics/schema.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const fleet = yield* Fleet
		const localInventory = yield* Inventory
		const exposures = yield* Exposures
		// A cache lookup inherits its caller's scope; shared sources belong to this layer, not the first RPC.
		const scope = yield* Effect.scope
		const inventory = yield* pipe(
			Stream.fromEffect(fleet.local),
			Stream.concat(
				Stream.merge(
					Stream.fromEffectSchedule(fleet.snapshot, Schedule.spaced(Duration.seconds(5))),
					pipe(
						Reactivity.stream(Effect.void, ['deployInventory']),
						Stream.drop(1),
						Stream.mapEffect(() => fleet.snapshot)
					)
				)
			),
			Stream.share({capacity: 1, replay: 1, strategy: 'sliding'})
		)
		// Viewers share one range sampler; the source stops when its last viewer leaves.
		const metrics = yield* Cache.make({
			capacity: Record.size(SERIES),
			lookup: (minutes: HistoryQuery['minutes']) => {
				const query = {minutes}
				return pipe(
					Stream.fromEffect(fleet.current(query)),
					Stream.concat(Stream.fromEffect(fleet.metrics(query))),
					Stream.concat(
						Stream.merge(
							Stream.fromEffectSchedule(
								fleet.current(query),
								Schedule.spaced(Duration.min(resolution(minutes), Duration.seconds(30)))
							),
							Stream.drain(
								Stream.fromEffectSchedule(
									fleet.metrics(query),
									Schedule.spaced(
										Duration.clamp(resolution(minutes), {maximum: Duration.seconds(30), minimum: Duration.seconds(5)})
									)
								)
							)
						)
					),
					Stream.share({capacity: 1, replay: 1, strategy: 'sliding'}),
					Effect.provideService(Scope.Scope, scope)
				)
			}
		})
		return RpcContracts.of({
			'exposures.apply': Effect.fnUntraced(
				function* (input) {
					const url = yield* exposures.expose(input)
					yield* localInventory.refresh
					return url
				},
				Reactivity.mutation(['deployInventory'])
			),
			'exposures.expose': fleet.expose,
			'exposures.hide': fleet.hide,
			'exposures.remove': Effect.fnUntraced(
				function* (input) {
					yield* exposures.hide(input.name)
					yield* localInventory.refresh
				},
				Reactivity.mutation(['deployInventory'])
			),
			'inventory.run': fleet.run,
			'inventory.snapshot': () => fleet.local,
			'inventory.start': input => Reactivity.mutation(localInventory.run(input), ['deployInventory']),
			'inventory.watch': () => inventory,
			'metrics.history': fleet.history,
			// Cached history at once, then every worker's fresh one; after that a slot of the range as each fills, at most every 30 seconds, while the other workers refresh beside it, at most every 5 seconds, so a sleeping one never holds back this one's seconds.
			'metrics.watch': query => Stream.unwrap(Cache.get(metrics, query.minutes))
		})
	})
)
