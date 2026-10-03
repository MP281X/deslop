import {
	Array,
	Boolean,
	Match,
	Clock,
	Config,
	Context,
	Layer,
	Crypto,
	Effect,
	Fiber,
	FileSystem,
	Number,
	Option,
	Path,
	Redacted,
	Schema,
	Semaphore,
	String,
	SubscriptionRef,
	pipe
} from 'effect'
import type {Stream} from 'effect'

import {Sources} from './internal/extraction.ts'
import {Organizer} from './internal/organization.ts'

import {captureUrl, pastedContent, sourceFor} from '#services/notes/lib/utils.ts'
import type {Capture, EditNote} from '#services/notes/schema.ts'
import {Note, NotesError, NotesState} from '#services/notes/schema.ts'

export class Notes extends Context.Service<
	Notes,
	{
		readonly capture: (input: Capture) => Effect.Effect<Note, NotesError>
		readonly changes: Stream.Stream<NotesState>
		readonly edit: (input: EditNote) => Effect.Effect<void, NotesError>
		readonly remove: (input: {id: string}) => Effect.Effect<void, NotesError>
	}
>()('@deslop/notes/services/notes/service/Notes') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const crypto = yield* Crypto.Crypto
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const configured = yield* Config.option(Config.String('NOTES_DATA_DIR'))
			const directory = yield* Option.match(configured, {
				onNone: () => Effect.map(Config.String('HOME'), home => path.join(home, '.deslop/deploy/notes')),
				onSome: Effect.succeed
			})
			const file = path.join(directory, 'notes.json')
			const scope = yield* Effect.scope
			const sources = yield* Sources
			const organizer = yield* Organizer
			const lock = yield* Semaphore.make(1)
			const captures = yield* Semaphore.make(1)
			const disk = Effect.fnUntraced(
				function* (next: NotesState) {
					const json = yield* Schema.encodeEffect(Schema.fromJsonString(NotesState))(next)
					yield* fs.writeFileString(`${file}.tmp`, json, {mode: 0o600})
					yield* fs.rename(`${file}.tmp`, file)
				},
				Effect.mapError(cause =>
					NotesError.make({cause: Redacted.make(cause), message: 'The note could not be saved to disk.'})
				)
			)
			yield* pipe(
				fs.makeDirectory(directory, {mode: 0o700, recursive: true}),
				Effect.mapError(cause =>
					NotesError.make({cause: Redacted.make(cause), message: 'The notes data directory is unavailable.'})
				)
			)
			const exists = yield* pipe(
				fs.exists(file),
				Effect.mapError(cause =>
					NotesError.make({cause: Redacted.make(cause), message: 'The notes file is unavailable.'})
				)
			)
			const loaded = exists
				? yield* pipe(
						fs.readFileString(file),
						Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(NotesState))),
						Effect.mapError(cause =>
							NotesError.make({
								cause: Redacted.make(cause),
								message: 'The notes file is unreadable or corrupt. It was not overwritten.'
							})
						)
					)
				: NotesState.make({aiReserved: 0, notes: []})
			const recovered = {
				...loaded,
				notes: Array.map(loaded.notes, note =>
					note.status === 'organizing'
						? {...note, issue: 'Organization was interrupted; the original was kept.', status: 'saved' as const}
						: note
				)
			}
			if (Array.some(loaded.notes, note => note.status === 'organizing')) yield* disk(recovered)
			const state = yield* SubscriptionRef.make<NotesState>(recovered)
			const write = Effect.fnUntraced(function* (next: NotesState) {
				yield* disk(next)
				yield* SubscriptionRef.set(state, next)
			})
			const find = Effect.fnUntraced(function* (id: string) {
				const current = yield* SubscriptionRef.get(state)
				return pipe(
					Array.findFirst(current.notes, note => note.id === id),
					Option.getOrUndefined
				)
			})
			const update = Effect.fnUntraced(function* (id: string, transform: (note: Note) => Note) {
				yield* lock.withPermit(
					Effect.uninterruptible(
						Effect.gen(function* () {
							const current = yield* SubscriptionRef.get(state)
							if (!Array.some(current.notes, note => note.id === id)) return
							yield* write({
								...current,
								notes: Array.map(current.notes, note => (note.id === id ? transform(note) : note))
							})
						})
					)
				)
			})
			const capture = Effect.fn('Notes.capture')(function* (input: Capture) {
				return yield* captures.withPermit(
					Effect.gen(function* () {
						const raw = String.trim(input.text)
						if (raw === '') return yield* NotesError.make({message: 'Paste a link or some text.'})
						const url = yield* Effect.try({
							catch: () => NotesError.make({message: 'The pasted URL is invalid.'}),
							try: () => captureUrl(raw)
						})
						const initial = yield* lock.withPermit(
							Effect.uninterruptible(
								Effect.gen(function* () {
									const current = yield* SubscriptionRef.get(state)
									const existing = pipe(
										Array.findFirst(current.notes, note => (url === null ? note.raw === raw : note.url === url)),
										Option.getOrUndefined
									)
									if (existing !== undefined) {
										const repeated = pipe(existing.raw, String.includes(raw))
										if (repeated && existing.status !== 'organizing') return {fresh: false, note: existing}
										const kept = Boolean.match(repeated, {
											onFalse: () => ({
												...existing,
												content: pipe(
													[existing.content, pastedContent(raw)],
													Array.filter(String.isNonEmpty),
													Array.join('\n')
												),
												issue: String.isEmpty(existing.issue)
													? 'Additional content saved without another AI request.'
													: existing.issue,
												raw: `${existing.raw}\n${raw}`
											}),
											onTrue: () => existing
										})
										const note = pipe(
											Match.value(kept),
											Match.when({status: 'organizing'}, item => ({
												...item,
												issue: 'Earlier organization did not complete; the original was kept.',
												status: 'saved' as const
											})),
											Match.orElse(item => item)
										)
										yield* write({
											...current,
											notes: Array.map(current.notes, item => (item.id === note.id ? note : item))
										})
										return {fresh: false, note}
									}
									const note = Note.make({
										content: pastedContent(raw),
										createdAt: yield* Clock.currentTimeMillis,
										id: yield* pipe(
											crypto.randomUUIDv4,
											Effect.mapError(cause =>
												NotesError.make({
													cause: Redacted.make(cause),
													message: 'A note identifier could not be generated.'
												})
											)
										),
										issue: '',
										raw,
										source: sourceFor(url),
										status: 'organizing',
										summary: '',
										tags: [],
										title: String.slice(0, 200)(pastedContent(raw) === '' ? (url ?? 'Note') : pastedContent(raw)),
										url
									})
									yield* write({...current, notes: Array.prepend(current.notes, note)})
									return {fresh: true, note}
								})
							)
						)
						if (!initial.fresh) return initial.note
						const original = initial.note
						const organized = Effect.gen(function* () {
							const extraction =
								original.url === null
									? {issue: '', text: ''}
									: yield* pipe(
											sources.extract(original.url),
											Effect.map(text => ({issue: '', text})),
											Effect.orElseSucceed(() => ({
												issue: 'Source content is unavailable; the original link was kept.',
												text: ''
											}))
										)
							const content: string = String.trim(`${original.content}\n${extraction.text}`)
							if ((yield* find(original.id)) === undefined) return
							if (content === '') {
								yield* update(original.id, note => ({
									...note,
									issue:
										extraction.issue === ''
											? 'No source text is available; the original link was kept.'
											: extraction.issue,
									status: 'saved'
								}))
								return
							}
							yield* update(original.id, note => ({...note, content, issue: extraction.issue}))
							if (!organizer.enabled) {
								yield* update(original.id, note => ({
									...note,
									issue: `${extraction.issue} AI is not configured; the original was kept.`,
									status: 'saved'
								}))
								return
							}
							const reserved = yield* lock.withPermit(
								Effect.uninterruptible(
									Effect.gen(function* () {
										const current = yield* SubscriptionRef.get(state)
										if (!Array.some(current.notes, note => note.id === original.id)) return false
										const nextReservation = Number.round(current.aiReserved + 0.005, 3)
										if (nextReservation > 0.25) return false
										yield* write({...current, aiReserved: nextReservation})
										return true
									})
								)
							)
							if (!reserved) {
								yield* update(original.id, note => ({
									...note,
									issue: 'The AI budget limit was reached; the original was kept.',
									status: 'saved'
								}))
								return
							}
							const result = yield* organizer.organize(String.slice(0, 10000)(content))
							yield* update(original.id, note => ({...note, ...result, issue: extraction.issue, status: 'ready'}))
						})
						yield* pipe(
							organized,
							Effect.catchCause(() =>
								update(original.id, note => ({
									...note,
									issue: 'Organization failed; the original was kept.',
									status: 'saved'
								}))
							)
						)
						return (yield* find(original.id)) ?? original
					})
				)
			})
			return Notes.of({
				capture: Effect.fn('Notes.accept')(function* (input: Capture) {
					const fiber = yield* pipe(capture(input), Effect.forkIn(scope))
					return yield* Fiber.join(fiber)
				}),
				changes: SubscriptionRef.changes(state),
				edit: Effect.fn('Notes.edit')(function* (input: EditNote) {
					yield* lock.withPermit(
						Effect.uninterruptible(
							Effect.gen(function* () {
								const current = yield* SubscriptionRef.get(state)
								const note = yield* find(input.id)
								if (note === undefined) return yield* NotesError.make({message: 'This note no longer exists.'})
								if (note.status === 'organizing') {
									return yield* NotesError.make({message: 'Wait for organization before editing this note.'})
								}
								yield* write({
									...current,
									notes: Array.map(current.notes, item =>
										item.id === input.id ? {...item, tags: input.tags, title: input.title} : item
									)
								})
							})
						)
					)
				}),
				remove: Effect.fn('Notes.remove')(function* (input: {id: string}) {
					yield* lock.withPermit(
						Effect.uninterruptible(
							Effect.gen(function* () {
								const current = yield* SubscriptionRef.get(state)
								yield* write({...current, notes: Array.filter(current.notes, note => note.id !== input.id)})
							})
						)
					)
				})
			})
		})
	)
}
