import {Context, Effect, Layer, Option, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'

import type {Admin} from '@deslop/runtime/shared/auth'

import type {ExposeInput} from '#exposures/contract.ts'
import {Exposures} from '#exposures/server.ts'
import type {ExposureName, Snapshot} from '#inventory/contract.ts'
import {Inventory} from '#inventory/server.ts'
import type {DeployError} from '#machine/contract.ts'

export class Machine extends Context.Service<
	Machine,
	{
		readonly expose: (input: ExposeInput, admin: Admin) => Effect.Effect<string, DeployError>
		readonly hide: (name: ExposureName, admin: Admin) => Effect.Effect<void, DeployError>
		// The inventory and the exposures Deploy owns, as last read.
		readonly view: Effect.Effect<Snapshot>
		// The same, read again when older than five seconds.
		readonly snapshot: Effect.Effect<Snapshot>
	}
>()('@deslop/deploy/machine/server/Machine') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const inventory = yield* Inventory
			const exposures = yield* Exposures
			const reactivity = yield* Reactivity.Reactivity
			const view = Effect.withSpan(
				Effect.gen(function* () {
					const snapshot = yield* inventory.snapshot
					// Owned exposures are one more source: a failed read shows as its error, as an inventory source's does.
					const owned = yield* Effect.match(exposures.items, {
						onFailure: cause => ({items: [], sources: [{error: Option.some(cause.message), name: 'Exposures'}]}),
						onSuccess: items => ({items, sources: []})
					})
					return {
						...snapshot,
						items: [...snapshot.items, ...owned.items],
						sources: [...snapshot.sources, ...owned.sources]
					} satisfies Snapshot
				}),
				'Machine.view'
			)
			// A change refreshes the inventory however it ends, since a failed one may have changed the machine, and wakes its viewers.
			function changing<A>(effect: Effect.Effect<A, DeployError>) {
				return pipe(
					effect,
					Effect.onExit(() => inventory.refresh),
					Effect.onExit(() => reactivity.invalidate(['deployInventory']))
				)
			}
			return Machine.of({
				expose: Effect.fn('Machine.expose')(function* (input, admin) {
					yield* Effect.annotateCurrentSpan({exposure: input.name})
					return yield* changing(exposures.expose(input, admin))
				}),
				hide: Effect.fn('Machine.hide')(function* (name, admin) {
					yield* Effect.annotateCurrentSpan({exposure: name})
					return yield* changing(exposures.hide(name, admin))
				}),
				snapshot: Effect.andThen(inventory.ensureFresh, view),
				view
			})
		})
	)
}
