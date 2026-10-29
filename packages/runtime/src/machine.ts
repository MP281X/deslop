import type {Schema} from 'effect'
import {Effect, Option} from 'effect'

import {Machine} from 'effect-machine'
import * as ActorAtom from 'effect-machine/atom'
import {AsyncResult, Atom} from 'effect/reactivity'

// A machine whose actor lives as long as the app: the atom reads its state, and setting it sends an event.
export function actorAtom<
	State extends {readonly _tag: string},
	Event extends {readonly _tag: string},
	States extends Record<string, Schema.Struct.Fields>,
	Events extends Record<string, Schema.Struct.Fields>,
	Output
>(machine: Machine.Machine<State, Event, never, States, Events, void, Output>) {
	const actor = Atom.keepAlive(Atom.make(Machine.scoped(Effect.tap(Machine.spawn(machine), spawned => spawned.start))))
	return Atom.keepAlive(
		Atom.writable(
			get =>
				Option.match(AsyncResult.value(get(actor)), {
					onNone: () => machine.initial,
					onSome: spawned => get(ActorAtom.make(spawned))
				}),
			(context, event: Event) =>
				Option.match(AsyncResult.value(context.get(actor)), {
					onNone: () => undefined,
					onSome: spawned => spawned.client.send(event)
				})
		)
	)
}
