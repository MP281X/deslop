import {Array, Effect} from 'effect'

import {SecureRandom} from 'effect/crypto'

import {findNotes} from '#services/notes/lib/utils.ts'
import {Notes} from '#services/notes/service.ts'
import {Tools} from '#tools/contracts.ts'

// The success schemas keep only a list item's fields, so the long texts stay out of list_notes and search_notes.
export const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const notes = yield* Notes
		const random = yield* SecureRandom.SecureRandom
		return Tools.of({
			delete_note: input => notes.remove(input),
			list_notes: input =>
				Effect.map(notes.list, all => ({
					notes: Array.take(Array.drop(all, input.offset), input.limit),
					total: all.length
				})),
			list_tags: () => Effect.map(notes.tags, tags => ({tags})),
			read_note: input => notes.get(input),
			reprocess_note: input => notes.regenerate(input),
			save_note: input => Effect.flatMap(random.uuidV4(), id => notes.capture({id, text: input.text})),
			search_notes: input =>
				Effect.map(notes.list, all => {
					const found = findNotes(all, input.query)
					return {notes: found, total: found.length}
				})
		})
	})
)
