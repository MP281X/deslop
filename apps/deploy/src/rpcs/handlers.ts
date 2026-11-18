import {Cache, Duration, Effect, Record, Schedule, Scope, Stream, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'

import {CurrentAdmin} from '@deslop/runtime/shared/auth'

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
					Stream.concat(Stream.fromEffect(Effect.andThen(fleet.metrics(query), fleet.current(query)))),
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
		// The sender already chose this worker and needs fresh inventory when it gets the reply.
		return RpcContracts.of({
			'exposures.apply': Effect.fnUntraced(
				function* (input) {
					return yield* Effect.onExit(exposures.expose(input), () => localInventory.refresh)
				},
				Effect.onExit(() => Reactivity.invalidate(['deployInventory']))
			),
			'exposures.expose': input => Effect.flatMap(CurrentAdmin, admin => fleet.expose(input, admin)),
			'exposures.hide': input => Effect.flatMap(CurrentAdmin, admin => fleet.hide(input, admin)),
			'exposures.remove': Effect.fnUntraced(
				function* (input) {
					yield* Effect.onExit(exposures.hide(input.name), () => localInventory.refresh)
				},
				Effect.onExit(() => Reactivity.invalidate(['deployInventory']))
			),
			'inventory.run': input => Effect.flatMap(CurrentAdmin, admin => fleet.run(input, admin)),
			'inventory.snapshot': () => Effect.andThen(localInventory.ensureFresh, fleet.local),
			'inventory.start': input =>
				Effect.onExit(localInventory.run(input), () => Reactivity.invalidate(['deployInventory'])),
			'inventory.watch': () => inventory,
			'metrics.history': fleet.history,
			// Emit cached peer history before refreshing peers; subsequent local and peer samplers run concurrently.
			'metrics.watch': query => Stream.unwrap(Cache.get(metrics, query.minutes))
		})
	})
)
