import {Array, DateTime, Effect, Option, Struct} from 'effect'

import {SecureRandom} from 'effect/crypto'

import {findNotes} from '#services/notes/lib/utils.ts'
import type {Note} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'
import type {NoteRow} from '#tools/contracts.ts'
import {Tools} from '#tools/contracts.ts'

function row(note: Note) {
	return {
		...Struct.pick(note, ['id', 'status', 'summary', 'tags', 'title', 'url']),
		saved: DateTime.formatIsoDateUtc(DateTime.makeUnsafe(note.createdAt))
	} satisfies NoteRow
}

export const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const notes = yield* Notes
		const random = yield* SecureRandom.SecureRandom
		return Tools.of({
			read_note: input => notes.get(input),
			// Saving a link that failed before reads it again.
			save_note: Effect.fnUntraced(function* (input) {
				const saved = yield* notes.capture({id: yield* random.uuidV4(), text: input.text})
				if (saved.status !== 'failed') return row(saved)
				yield* notes.regenerate({id: saved.id})
				return row({...Struct.omit(saved, ['issue']), status: 'organizing'})
			}),
			search_notes: input =>
				Effect.map(notes.list, all => {
					const found = Option.match(Option.fromUndefinedOr(input.query), {
						onNone: () => all,
						onSome: query => findNotes(all, query)
					})
					return {notes: Array.map(Array.take(Array.drop(found, input.offset), input.limit), row), total: found.length}
				})
		})
	})
)
