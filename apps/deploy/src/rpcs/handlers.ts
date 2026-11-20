import {Array, Boolean, Cache, Duration, Effect, Option, Record, Schedule, Scope, Stream, pipe} from 'effect'

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
		// This worker and each peer refresh on their own schedules into one view, so a slow peer delays only its own rows.
		const inventory = yield* pipe(
			Stream.fromEffect(fleet.view),
			Stream.concat(
				Stream.mergeAll(
					[
						Stream.fromEffectSchedule(
							Effect.andThen(localInventory.ensureFresh, fleet.view),
							Schedule.spaced(Duration.seconds(5))
						),
						...Array.map(fleet.peers, worker =>
							Stream.fromEffectSchedule(
								Effect.andThen(fleet.peerSnapshot(worker), fleet.view),
								Schedule.spaced(Duration.seconds(5))
							)
						),
						pipe(
							Reactivity.stream(Effect.void, ['deployInventory']),
							Stream.drop(1),
							Stream.mapEffect(() => fleet.view)
						)
					],
					{concurrency: 'unbounded'}
				)
			),
			Stream.share({capacity: 1, replay: 1, strategy: 'sliding'})
		)
		// Viewers share one range sampler; the source stops when its last viewer leaves. Each peer's history arrives on its own, so a slow peer never holds back this worker's.
		const metrics = yield* Cache.make({
			capacity: Record.size(SERIES),
			lookup: (minutes: HistoryQuery['minutes']) => {
				const query = {minutes}
				return pipe(
					Stream.mergeAll(
						[
							Stream.fromEffectSchedule(
								fleet.current(query),
								Schedule.spaced(Duration.min(resolution(minutes), Duration.seconds(30)))
							),
							...Array.map(fleet.peers, worker =>
								Stream.fromEffectSchedule(
									Effect.andThen(fleet.peerMetrics(worker, query), fleet.current(query)),
									Schedule.spaced(
										Duration.clamp(resolution(minutes), {maximum: Duration.seconds(30), minimum: Duration.seconds(5)})
									)
								)
							)
						],
						{concurrency: 'unbounded'}
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
					return yield* Effect.onExit(exposures.expose(input, yield* CurrentAdmin), () => localInventory.refresh)
				},
				Effect.onExit(() => Reactivity.invalidate(['deployInventory']))
			),
			'exposures.expose': input => Effect.flatMap(CurrentAdmin, admin => fleet.expose(input, admin)),
			'exposures.hide': input => Effect.flatMap(CurrentAdmin, admin => fleet.hide(input, admin)),
			'exposures.remove': Effect.fnUntraced(
				function* (input) {
					yield* Effect.onExit(exposures.hide(input.name, yield* CurrentAdmin), () => localInventory.refresh)
				},
				Effect.onExit(() => Reactivity.invalidate(['deployInventory']))
			),
			'inventory.run': input => Effect.flatMap(CurrentAdmin, admin => fleet.run(input, admin)),
			'inventory.snapshot': () => Effect.andThen(localInventory.ensureFresh, fleet.local),
			'inventory.start': Effect.fnUntraced(
				function* (input) {
					yield* localInventory.run(input, yield* CurrentAdmin)
				},
				Effect.onExit(() => Reactivity.invalidate(['deployInventory']))
			),
			'inventory.watch': () => inventory,
			'metrics.history': fleet.history,
			// Only the chosen worker's samples travel; the others keep what the machine tabs show.
			'metrics.watch': query =>
				Stream.map(Stream.unwrap(Cache.get(metrics, query.minutes)), histories => {
					const chosen = Option.orElse(query.worker, () =>
						pipe(
							histories,
							Array.map(machine => machine.worker),
							Array.head
						)
					)
					return Array.map(histories, machine =>
						pipe(
							chosen,
							Option.contains(machine.worker),
							Boolean.match({onFalse: () => ({...machine, samples: []}), onTrue: () => machine})
						)
					)
				})
		})
	})
)
