import {Array, Context, Effect, Order, Schema} from 'effect'

import type {NotesError} from '#services/notes/schema.ts'
import {Capture} from '#services/notes/schema.ts'

// A capture this iPhone has not handed to the server yet. The app and the share extension write the same file shape.
export type Pending = typeof Pending.Type
export const Pending = Schema.Struct({...Capture.fields, createdAt: Schema.Finite})

export class Outbox extends Context.Service<
	Outbox,
	{
		readonly add: (pending: Pending) => Effect.Effect<void, NotesError>
		readonly list: Effect.Effect<Pending[], NotesError>
		readonly remove: (id: Pending['id']) => Effect.Effect<void, NotesError>
	}
>()('@deslop/stash/lib/outbox') {}

// Sends pending captures oldest first. A capture leaves the outbox only after the server confirmed it;
// a refused one stays for the next run. The server ignores a capture id it already saved, so a resend is harmless.
export const deliver = Effect.fn('Outbox.deliver')(function* <E>(
	send: (capture: Capture) => Effect.Effect<unknown, E>
) {
	const outbox = yield* Outbox
	const sent = yield* Effect.forEach(
		Array.sort(
			yield* outbox.list,
			Order.mapInput(Order.Number, (item: Pending) => item.createdAt)
		),
		item =>
			Effect.matchEffect(send({id: item.id, text: item.text}), {
				onFailure: () => Effect.succeed(false),
				onSuccess: () => Effect.as(outbox.remove(item.id), true)
			})
	)
	return {
		kept: Array.filter(sent, delivered => !delivered).length,
		sent: Array.filter(sent, delivered => delivered).length
	}
})
