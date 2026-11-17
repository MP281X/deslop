import {Context, Effect, Function, Layer, MutableRef, pipe} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult, Atom} from 'effect/reactivity'

import {alertFailure} from '#lib/alerts.ts'

type RemovalError = {_tag: string; message: string}
const removalEvents = Machine.events({Removed: {}, Restored: {}})

export type Removal<Id extends string> = ReturnType<typeof makeRemoval<Id, {_tag: string; message: string}>>

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
				events: removalEvents,
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
	// The subscription holds the machine while the row is absent, then releases it after undo, completion or failure.
	const heldAtom = Atom.family((id: Id) => {
		const removing = machineAtom(id)
		return Atom.readable(get => () => {
			const pending = MutableRef.make(false)
			const release = get.registry.subscribe(removing.result, result => {
				if (
					AsyncResult.isSuccess(result) &&
					(result.value.state.path === 'Pending' || result.value.state.path === 'Removing')
				) {
					MutableRef.set(pending, true)
					return
				}
				if (MutableRef.get(pending) || AsyncResult.isFailure(result)) release()
			})
		})
	})
	return {
		events: removalEvents,
		machine: machineAtom,
		removeAtom: Atom.writable(Function.constUndefined, (context, id: Id) => {
			context.get(heldAtom(id))()
			context.set(machineAtom(id).send, removalEvents.Removed())
		})
	}
}
