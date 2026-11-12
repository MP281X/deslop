import {Array, Boolean, DateTime, Effect, Option, Order, String, Struct, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {findNotes} from '#services/notes/lib/utils.ts'
import type {Note} from '#services/notes/schema.ts'
import {Notes} from '#services/notes/service.ts'
import type {NoteSummary} from '#tools/contracts.ts'
import {ToolContracts} from '#tools/contracts.ts'

function row(note: Note) {
	return {
		...Struct.pick(note, ['id', 'status', 'summary', 'tags', 'title', 'url']),
		saved: DateTime.formatIsoDateUtc(DateTime.makeUnsafe(note.createdAt))
	} satisfies NoteSummary
}

export const ToolHandlers = ToolContracts.toLayer(
	Effect.gen(function* () {
		const notes = yield* Notes
		const random = yield* SecureRandom.SecureRandom
		return ToolContracts.of({
			read_note: input =>
				Effect.map(notes.get(input), note => {
					const metadata = {...row(note), ...Struct.pick(note, ['author', 'issue'])}
					const section = Boolean.match(input.section === 'body' && !String.isNonEmpty(note.body ?? ''), {
						onFalse: () => input.section,
						onTrue: () => 'text' as const
					})
					const source = note[section] ?? ''
					const chunk = String.slice(input.offset, input.offset + input.limit)(source)
					const boundary = Boolean.match(section === 'transcript' && input.offset + chunk.length < source.length, {
						onFalse: () => chunk.length,
						onTrue: () =>
							Option.getOrElse(
								Option.map(String.lastIndexOf('\n')(chunk), index => index + 1),
								() => chunk.length
							)
					})
					const text = String.slice(0, boundary)(chunk)
					return {
						...metadata,
						[section]: text,
						...Boolean.match(input.offset + text.length < source.length, {
							onFalse: () => ({}),
							onTrue: () => ({nextOffset: input.offset + text.length})
						})
					}
				}),
			remove_note: input => Effect.as(notes.remove(input), {id: input.id}),
			save_note: Effect.fnUntraced(function* (input) {
				const user = yield* CurrentUser
				const saved = yield* notes.capture(user.id, {id: yield* random.uuidV4(), text: input.text})
				if (saved.status !== 'failed') return row(saved)
				yield* notes.regenerate(user.id, {id: saved.id})
				return row({...Struct.omit(saved, ['issue']), status: 'organizing'})
			}),
			search_notes: input =>
				Effect.map(notes.list, all => {
					const sorted = Array.sort(
						Option.match(Option.fromUndefinedOr(input.query), {
							onNone: () => all,
							onSome: query => findNotes(all, query)
						}),
						Order.combine(
							Order.mapInput(Order.flip(Order.Number), (note: Note) => note.createdAt),
							Order.mapInput(Order.flip(Order.String), (note: Note) => note.id)
						)
					)
					const remaining = Array.filter(
						sorted,
						note =>
							input.cursor === undefined ||
							note.createdAt < input.cursor.createdAt ||
							(note.createdAt === input.cursor.createdAt && note.id < input.cursor.id)
					)
					const page = Array.take(remaining, input.limit)
					return {
						notes: Array.map(page, row),
						total: sorted.length,
						...pipe(
							page,
							Array.last,
							Option.filter(() => remaining.length > input.limit),
							Option.match({onNone: () => ({}), onSome: last => ({nextCursor: Struct.pick(last, ['createdAt', 'id'])})})
						)
					}
				})
		})
	})
)
