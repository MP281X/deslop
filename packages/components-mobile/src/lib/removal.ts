import {Context, Effect, Layer, pipe} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {Atom} from 'effect/reactivity'

import {alert} from '#lib/utils.ts'

type RemovalError = {_tag: string; message: string}

class Removal extends Context.Service<
	Removal,
	{readonly notRemoved: string; readonly remove: (id: string) => Effect.Effect<void, RemovalError>}
>()('@deslop/components-mobile/lib/removal') {}

// A removal reaches the server only after eight seconds; until then its row can restore it.
export function makeRemoval<E extends {_tag: string; message: string}>(options: {
	notRemoved: string
	remove: (id: string, context: Atom.AtomContext) => Effect.Effect<void, E>
}) {
	const bound = AtomMachine.bind(
		Atom.runtime(get =>
			Layer.succeed(Removal, Removal.of({notRemoved: options.notRemoved, remove: id => options.remove(id, get)}))
		)
	)
	const machine = Atom.family((id: string) =>
		bound.make(
			Machine.make({
				effects: {
					remove: Effect.gen(function* () {
						const removal = yield* Removal
						yield* pipe(removal.remove(id), alert(removal.notRemoved))
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
	const held = Atom.family((id: string) => {
		const removing = machine(id)
		return Atom.keepAlive(Atom.readable(get => get(removing.ref)))
	})
	return {
		machine,
		removeAtom: Atom.writable(
			() => undefined,
			(context, id: string) => {
				context.get(held(id))
				context.set(machine(id).send, {_tag: 'Removed'})
			}
		)
	}
}
