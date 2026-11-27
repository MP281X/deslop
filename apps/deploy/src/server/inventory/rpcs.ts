import {Duration, Effect, Schedule, Stream, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'

import {CurrentAdmin} from '@deslop/runtime/shared/auth'

import {InventoryRpcs} from '#contracts'

import {Inventory} from '#server/inventory/service.ts'
import {Machine} from '#server/machine/service.ts'

export const inventoryHandlers = InventoryRpcs.toLayer(
	Effect.gen(function* () {
		const inventory = yield* Inventory
		const machine = yield* Machine
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
		return InventoryRpcs.of({
			'inventory.logs': input => Effect.flatMap(CurrentAdmin, admin => inventory.logs(input, admin)),
			'inventory.restart': input => Effect.flatMap(CurrentAdmin, admin => inventory.restart(input, admin)),
			'inventory.run': input => Effect.flatMap(CurrentAdmin, admin => inventory.run(input, admin)),
			'inventory.stop': input => Effect.flatMap(CurrentAdmin, admin => inventory.stop(input, admin)),
			'inventory.watch': () => view
		})
	})
)
