import {Context, Effect, Layer, pipe} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {Atom} from 'effect/reactivity'

import {alertFailure} from '#lib/alerts.ts'

type RemovalError = {_tag: string; message: string}

// A removal reaches the server only after eight seconds; until then its row can restore it.
export function makeRemoval<Id extends string, E extends {_tag: string; message: string}>(options: {
	notRemoved: string
	remove: (id: Id, context: Atom.AtomContext) => Effect.Effect<void, E>
}) {
	class Removal extends Context.Service<
		Removal,
		{readonly notRemoved: string; readonly remove: (id: Id) => Effect.Effect<void, RemovalError>}
	>()('@deslop/components-mobile/lib/removal') {}

	const bound = AtomMachine.bind(
		Atom.runtime(get =>
			Layer.succeed(Removal, Removal.of({notRemoved: options.notRemoved, remove: id => options.remove(id, get)}))
		)
	)
	const machineAtom = Atom.family((id: Id) =>
		bound.make(
			Machine.make({
				effects: {
					remove: Effect.gen(function* () {
						const removal = yield* Removal
						yield* pipe(removal.remove(id), alertFailure(removal.notRemoved))
					})
				},
				events: Machine.events({Removed: {}, Restored: {}}),
				root: Machine.state({states: {Idle: {}, Pending: {}, Removed: {}, Removing: {}}}),
				timers: {expire: '8 seconds'}
			}).handle({
				initial: {target: 'Idle'},
				states: {
					Idle: {on: {Removed: {target: 'Pending'}}},
					Pending: {invoke: {onDone: {target: 'Removing'}, src: 'expire'}, on: {Restored: {target: 'Idle'}}},
					Removed: {},
					Removing: {invoke: {onDone: {target: 'Removed'}, onFailure: {target: 'Idle'}, src: 'remove'}}
				}
			})
		)
	)
	// A removal outlives its row, which a search, a folded section or a closing detail unmounts; the family forgets a machine nothing references, so the hold keeps the machine itself.
	const heldAtom = Atom.family((id: Id) => {
		const removing = machineAtom(id)
		return Atom.keepAlive(Atom.readable(get => get(removing.ref)))
	})
	return {
		machine: machineAtom,
		removeAtom: Atom.writable(
			() => undefined,
			(context, id: Id) => {
				context.get(heldAtom(id))
				context.set(machineAtom(id).send, {_tag: 'Removed'})
			}
		)
	}
}
