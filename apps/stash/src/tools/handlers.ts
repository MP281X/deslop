import {Array, Crypto, Effect} from 'effect'

import {findNotes} from '#services/notes/lib/utils.ts'
import {NotesError} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'
import {Tools} from '#tools/contracts.ts'

// The success schemas keep only a list item's fields, so the long texts stay out of list and search.
export const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const notes = yield* Notes
		const crypto = yield* Crypto.Crypto
		return Tools.of({
			get: input => notes.get(input),
			list: input =>
				Effect.map(notes.list, all => ({
					notes: Array.take(Array.drop(all, input.offset), input.limit),
					total: all.length
				})),
			regenerate: input => notes.regenerate(input),
			remove: input => notes.remove(input),
			save: input =>
				Effect.flatMap(
					Effect.mapError(crypto.randomUUIDv4(), cause => NotesError.make({cause, message: 'No note id.'})),
					id => notes.capture({id, text: input.text})
				),
			search: input =>
				Effect.map(notes.list, all => {
					const found = findNotes(all, input.query)
					return {notes: found, total: found.length}
				})
		})
	})
)
