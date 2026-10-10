import {Array, Context, Effect, Order, Schema, pipe} from 'effect'

import type {NotesError} from '#services/notes/schema.ts'
import {FileType, NoteId} from '#services/notes/schema.ts'

// A capture this iPhone has not handed to the server yet. The app and the share extension write the same file shape.
// A photo, screenshot or video waits beside it in the same folder, named by `file`, and its text is empty.
export type Pending = typeof Pending.Type
export const Pending = Schema.Struct({
	createdAt: Schema.Finite,
	file: Schema.optionalKey(Schema.Struct({name: Schema.String, type: FileType})),
	id: NoteId,
	text: pipe(Schema.String, Schema.check(Schema.isMaxLength(20_000)))
})

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
	send: (pending: Pending) => Effect.Effect<unknown, E>
) {
	const outbox = yield* Outbox
	const sent = yield* Effect.forEach(
		Array.sort(
			yield* outbox.list,
			Order.mapInput(Order.Number, (item: Pending) => item.createdAt)
		),
		item =>
			Effect.matchEffect(send(item), {
				onFailure: () => Effect.succeed(false),
				onSuccess: () => Effect.as(outbox.remove(item.id), true)
			})
	)
	return {
		kept: Array.filter(sent, delivered => !delivered).length,
		sent: Array.filter(sent, delivered => delivered).length
	}
})
