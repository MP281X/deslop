import {Boolean, Cache, DateTime, Duration, Effect, Record, Schedule, Scope, Stream, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'

import {CurrentAdmin} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Inventory} from '#services/inventory/service.ts'
import {Machine} from '#services/machine/service.ts'
import {SERIES, resolution} from '#services/metrics/lib/utils.ts'
import type {HistoryQuery} from '#services/metrics/schema.ts'
import {Metrics} from '#services/metrics/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const machine = yield* Machine
		const inventory = yield* Inventory
		const metrics = yield* Metrics
		// A cache lookup inherits its caller's scope; shared sources belong to this layer, not the first RPC.
		const scope = yield* Effect.scope
		// Viewers share one inventory, read every five seconds and again after each change.
		const view = yield* pipe(
			Stream.fromEffect(machine.view),
			Stream.concat(
				Stream.mergeAll(
					[
						Stream.fromEffectSchedule(
							Effect.andThen(inventory.ensureFresh, machine.view),
							Schedule.spaced(Duration.seconds(5))
						),
						pipe(
							Reactivity.stream(Effect.void, ['deployInventory']),
							Stream.drop(1),
							Stream.mapEffect(() => machine.view)
						)
					],
					{concurrency: 'unbounded'}
				)
			),
			Stream.share({capacity: 1, replay: 1, strategy: 'sliding'})
		)
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
		return RpcContracts.of({
			'exposures.expose': input => Effect.flatMap(CurrentAdmin, admin => machine.expose(input, admin)),
			'exposures.hide': input => Effect.flatMap(CurrentAdmin, admin => machine.hide(input, admin)),
			'inventory.logs': input => Effect.flatMap(CurrentAdmin, admin => inventory.logs(input, admin)),
			'inventory.restart': input => Effect.flatMap(CurrentAdmin, admin => inventory.restart(input, admin)),
			'inventory.run': input => Effect.flatMap(CurrentAdmin, admin => machine.run(input, admin)),
			'inventory.stop': input => Effect.flatMap(CurrentAdmin, admin => inventory.stop(input, admin)),
			'inventory.watch': () => view,
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
