import {Array, DateTime, Effect, Option, Struct} from 'effect'

import {SecureRandom} from 'effect/crypto'

import {CurrentUser} from '@deslop/runtime/shared/auth'

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
			read_note: input =>
				Effect.map(notes.get(input), note =>
					Struct.omit(note, ['createdAt', 'file', 'id', 'image', 'requester', 'source'])
				),
			remove_note: input => notes.remove(input),
			save_note: Effect.fnUntraced(function* (input) {
				const user = yield* CurrentUser
				const saved = yield* notes.capture(user.id, {id: yield* random.uuidV4(), text: input.text})
				if (saved.status !== 'failed') return row(saved)
				yield* notes.regenerate(user.id, {id: saved.id})
				return row({...Struct.omit(saved, ['issue']), status: 'organizing'})
			}),
			search_notes: input =>
				Effect.map(notes.list, all => {
					const found = Option.match(Option.fromUndefinedOr(input.query), {
						onNone: () => all,
						onSome: query => findNotes(all, query)
					})
					return {notes: Array.map(Array.take(found, input.limit), row), total: found.length}
				})
		})
	})
)
