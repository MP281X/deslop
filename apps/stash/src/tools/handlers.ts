import {Array, Boolean, DateTime, Effect, Function, Option, String, Struct, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {NoteId} from '#services/notes/schema.ts'
import type {NoteItem} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'
import type {NoteSummary} from '#tools/contracts.ts'
import {ToolContracts} from '#tools/contracts.ts'

function row(note: NoteItem) {
	return {
		...Struct.pick(note, ['id', 'status', 'summary', 'tags', 'title', 'url']),
		saved: DateTime.formatIsoDateUtc(note.createdAt)
	} satisfies NoteSummary
}

export const ToolHandlers = ToolContracts.toLayer(
	Effect.gen(function* () {
		const notes = yield* Notes
		const random = yield* SecureRandom.SecureRandom
		return ToolContracts.of({
			read_note: Effect.fnUntraced(function* (input) {
				const item = yield* notes.item(input.id)
				const note = yield* notes.get(input.id)
				const texts = {
					body: note.body,
					content: Option.some(note.content),
					screenText: note.screenText,
					text: Option.some(note.text),
					topics: note.topics,
					transcript: note.transcript
				}
				const section = Boolean.match(input.section === 'body' && !Option.exists(note.body, String.isNonEmpty), {
					onFalse: () => input.section,
					onTrue: () => 'text' as const
				})
				const source = Option.getOrElse(texts[section], Function.constant(''))
				const chunk = String.slice(input.offset, input.offset + input.limit)(source)
				const text = Boolean.match(section === 'transcript' && input.offset + chunk.length < source.length, {
					onFalse: () => chunk,
					onTrue: () =>
						pipe(
							chunk,
							String.lastIndexOf('\n'),
							Option.map(index => String.slice(0, index + 1)(chunk)),
							Option.getOrElse(() => chunk)
						)
				})
				const sections = {
					body: Option.none<string>(),
					content: Option.none<string>(),
					screenText: Option.none<string>(),
					text: Option.none<string>(),
					topics: Option.none<string>(),
					transcript: Option.none<string>()
				}
				return {
					...row(item),
					...Struct.pick(item, ['author', 'issue']),
					...sections,
					nextOffset: Option.liftPredicate(input.offset + text.length, offset => offset < source.length),
					[section]: Option.some(text)
				}
			}),
			remove_note: input => Effect.as(notes.remove(input.id), {id: input.id}),
			save_note: Effect.fnUntraced(function* (input) {
				const user = yield* CurrentUser
				const saved = yield* notes.capture(user.id, {id: NoteId.make(yield* random.uuidV4()), text: input.text})
				if (saved.status !== 'failed') return row(saved)
				yield* notes.regenerate(user.id, saved.id)
				return {...row(saved), status: 'organizing' as const}
			}),
			search_notes: input =>
				Effect.map(
					notes.list({
						cursor: input.cursor,
						limit: input.limit,
						query: Option.getOrElse(input.query, Function.constant(''))
					}),
					page => ({nextCursor: page.next, notes: Array.map(page.items, row), total: page.total})
				)
		})
	})
)
