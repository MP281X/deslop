import type {Cause, SchemaIssue} from 'effect'
import {
	Array,
	Boolean,
	ByteSize,
	Context,
	Duration,
	Effect,
	FileSystem,
	Function,
	Layer,
	Match,
	Option,
	Path,
	RcMap,
	Schedule,
	Schema,
	Semaphore,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import type {PlatformError} from 'effect/PlatformError'
import {Reactivity} from 'effect/reactivity'
import {SqlClient, SqlError, SqlModel, SqlSchema} from 'effect/sql'

import {dataDirectory} from '@deslop/runtime/server/store'
import type {UserId} from '@deslop/runtime/shared/auth'

import {changeNote, newNote} from './changes.ts'
import {isVideo} from './content.ts'
import {Note, NoteChange, NoteId, NoteTag, NotesError, RetiredNote, Tag, TagEntry} from './contract.ts'
import type {Capture, FileType, Image, Organization} from './contract.ts'
import {indexNotes, migrations} from './migrations.ts'
import {Runs} from './runs.ts'
import {captureUrl} from './shared.ts'

import {saveState} from '#activity/contract.ts'
import {reconcileOrganization} from '#tags/tags.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly notes: never
		readonly stashProgress: never
	}
}

export function asStorageNotesError(
	cause:
		| SqlError.SqlError
		| Schema.SchemaError
		| SchemaIssue.Issue
		| PlatformError
		| Cause.NoSuchElementError
		| NotesError
) {
	// A NotesError already says what happened, such as a deleted note's retired id.
	if (Schema.is(NotesError)(cause)) return cause
	return NotesError.make({cause, message: 'The notes or their files could not be read or written.'})
}

export const asNotesError = Effect.mapError(asStorageNotesError)

export const missing = NotesError.make({message: 'No note has this id; find its id with search_notes.'})

const removed = NotesError.make({message: 'This note was deleted after it was saved.', reason: 'Removed'})

// SQLite waits its busy timeout for the write lock before it reports the database locked, so a retryable SQL error, wrapped or not, is a database still busy; any other storage failure is not helped by waiting.
function busy(error: unknown) {
	const cause = pipe(
		Match.value(error),
		Match.when(Schema.is(NotesError), failure => failure.cause),
		Match.orElse(Function.identity)
	)
	return SqlError.isSqlError(cause) && cause.isRetryable
}

const patiently = Schedule.modifyDelay(Schedule.exponential('1 second'), step =>
	Effect.succeed(Duration.min(step.duration, Duration.seconds(30)))
)

// What a provider answered, or the end of a run, is tried again with a growing pause until the database takes it: dropping it would ask the provider, and charge, again. A stop or a removal interrupts the wait.
function untilStored<A, E, R>(write: Effect.Effect<A, E, R>) {
	// oxlint-disable-next-line @deslop/coding-standards/retry-policy -- Only a busy database is retried, and the write is the one way an answer already paid for is kept; a bound would drop it and ask the provider again.
	return Effect.retry(write, {schedule: patiently, while: busy})
}

// The notes' rows and files, and what keeps them in step: the writes of a capture, an upload, a removal and each step of organizing, and the state that lets a run and a request take turns.
export class Notes extends Context.Service<Notes>()('@deslop/stash/notes/server/Notes', {
	make: Effect.fnUntraced(function* (directory: string) {
		const sql = yield* SqlClient.SqlClient
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const images = path.join(directory, 'images')
		const files = path.join(directory, 'files')
		function removeFiles(id: NoteId) {
			return pipe(
				fs.remove(path.join(images, id), {force: true}),
				Effect.andThen(fs.remove(path.join(files, id), {force: true})),
				Effect.mapError(cause =>
					NotesError.make({cause, message: 'The note was deleted, but its saved files could not be removed.'})
				)
			)
		}
		const publications = yield* RcMap.make({lookup: (_id: NoteId) => Semaphore.make(1)})
		const runs = yield* Runs
		// Writes tell this Reactivity of their commits, so callers need none of their own.
		const reactivity = yield* Reactivity.Reactivity
		const withReactivity = Effect.provideService(Reactivity.Reactivity, reactivity)

		yield* asNotesError(fs.makeDirectory(images, {mode: 0o700, recursive: true}))
		yield* asNotesError(fs.makeDirectory(files, {mode: 0o700, recursive: true}))
		function reindex(id: NoteId) {
			return indexNotes(sql, sql`id = ${id}`)
		}

		const notes = yield* SqlModel.makeRepository(Note, {idColumn: 'id', spanPrefix: 'Notes', tableName: Note.table})

		// Locally canonical links join immediately; shortened links join after background resolution.
		const findSaved = SqlSchema.findOneOption({
			Request: Schema.Struct({id: NoteId, url: Schema.OptionFromNullOr(Schema.String)}),
			Result: Note,
			execute: request => sql`
				SELECT * FROM notes WHERE id = ${request.id} OR url = ${request.url}
				ORDER BY id = ${request.id} DESC
				LIMIT 1
			`
		})
		const findResolved = SqlSchema.findOneOption({
			Request: Schema.Struct({id: NoteId, url: Schema.String}),
			Result: Note,
			execute: request => sql`
				SELECT * FROM notes WHERE id != ${request.id} AND url = ${request.url}
				ORDER BY createdAt, id LIMIT 1
			`
		})
		const findRetired = SqlSchema.findOneOption({
			Request: NoteId,
			Result: RetiredNote,
			execute: id => sql`SELECT * FROM ${sql(RetiredNote.table)} WHERE id = ${id}`
		})
		const retire = SqlSchema.void({
			Request: RetiredNote.insert,
			execute: row => sql`INSERT OR REPLACE INTO ${sql(RetiredNote.table)} ${sql.insert(row)}`
		})
		// Tags in use, most used first, with their definitions.
		const listTagEntries = SqlSchema.findAll({
			Request: Schema.Void,
			Result: TagEntry,
			execute: () => sql`
				SELECT tags.name, tags.definition, count(*) AS count
				FROM note_tags JOIN tags ON tags.name = note_tags.tag
				GROUP BY tags.name
				ORDER BY count DESC, tags.name
			`
		})
		// A tag keeps the definition it was first given; one first used without a definition takes the next it is given.
		const defineTags = SqlSchema.void({
			Request: Schema.NonEmptyArray(Tag.insert),
			execute: rows => sql`
				INSERT INTO ${sql(Tag.table)} ${sql.insert(rows)}
				ON CONFLICT (name) DO UPDATE SET definition = coalesce(definition, excluded.definition)
			`
		})
		const insertNoteTags = SqlSchema.void({
			Request: Schema.NonEmptyArray(NoteTag.insert),
			execute: rows => sql`INSERT INTO ${sql(NoteTag.table)} ${sql.insert(rows)}`
		})
		const deleteNoteTags = SqlSchema.void({
			Request: NoteId,
			execute: id => sql`DELETE FROM ${sql(NoteTag.table)} WHERE noteId = ${id}`
		})

		function findNote(id: NoteId) {
			return pipe(notes.findById(id), Effect.catchNoSuchElement, asNotesError)
		}

		// Store a transition against the note the caller reread inside its write transaction, so an intervening change survives and a note removed meanwhile stays removed.
		function storeChange(note: Note, update: NoteChange) {
			return pipe(
				Match.value(changeNote(note, update)),
				Match.tag('Unchanged', () => Effect.void),
				// The id stays retired, so a late resend of its capture cannot bring the note back.
				Match.tag('Removed', () =>
					pipe(
						notes.delete(note.id),
						Effect.andThen(
							retire({
								id: note.id,
								mergedInto: pipe(
									Match.value(update),
									Match.tag('remove', removal => removal.into),
									Match.orElse(() => Option.none<NoteId>())
								)
							})
						),
						Reactivity.mutation(['notes'])
					)
				),
				Match.tag('Changed', changed =>
					pipe(
						notes.update(Struct.pick(changed.note, Struct.keys(Note.update.fields))),
						Effect.andThen(reindex(note.id)),
						Reactivity.mutation(['notes'])
					)
				),
				Match.exhaustive
			)
		}

		function changeIn(id: NoteId, update: NoteChange) {
			return Effect.flatMap(
				findNote(id),
				Option.match({onNone: () => Effect.void, onSome: note => storeChange(note, update)})
			)
		}

		// A change a run stores.
		function change(id: NoteId, update: NoteChange) {
			return pipe(changeIn(id, update), sql.withTransaction, runs.exclusive, asNotesError)
		}

		// A change that stores a provider's answer or settles the run; each try takes the permit on its own, so the pause before the next does not hold it.
		function persist(id: NoteId, update: NoteChange) {
			return pipe(changeIn(id, update), sql.withTransaction, runs.exclusive, untilStored, asNotesError)
		}

		// Called in the transaction that leaves the note organizing: once it commits, the person has asked again, the claim looks at once and the run links back to this request.
		function organizeLater(id: NoteId) {
			return Effect.flatMap(Effect.option(Effect.currentSpan), request => sql.afterCommit(runs.requested(id, request)))
		}

		// A new note is searchable and waits for a claim from the transaction that saves it.
		function insertNote(note: ReturnType<typeof newNote>) {
			return pipe(
				Note.insert.makeEffect(note),
				Effect.flatMap(notes.insert),
				Effect.tap(() => reindex(note.id)),
				Effect.tap(() => organizeLater(note.id)),
				Reactivity.mutation(['notes'])
			)
		}

		const storeImage = Effect.fnUntraced(function* (id: NoteId, image: Image) {
			yield* asNotesError(fs.writeFile(path.join(images, id), image.bytes, {mode: 0o600}))
			yield* change(id, NoteChange.cases.image.make({image: image.type}))
		})

		const writeOrganization = Effect.fnUntraced(function* (
			note: Note,
			found: ReturnType<typeof reconcileOrganization>,
			read: string
		) {
			yield* deleteNoteTags(note.id)
			yield* Array.match(found.tags, {
				onEmpty: () => Effect.void,
				onNonEmpty: tags =>
					Effect.andThen(
						defineTags(tags),
						insertNoteTags(Array.map(tags, (entry, position) => ({noteId: note.id, position, tag: entry.name})))
					)
			})
			yield* storeChange(note, NoteChange.cases.organize.make({organization: found.organization, read}))
		})

		// The organized note, its tags and their definitions land together or not at all, and watchers hear of it once it commits; a note removed meanwhile stays removed, and words shared after `read` stay visible.
		function organized(id: NoteId, organization: Organization, read: string) {
			return pipe(
				Effect.flatMap(
					findNote(id),
					Option.match({
						onNone: () => Effect.void,
						onSome: note =>
							Effect.flatMap(listTagEntries(), entries =>
								writeOrganization(
									note,
									reconcileOrganization(
										organization,
										Array.map(entries, entry => entry.name)
									),
									read
								)
							)
					})
				),
				sql.withTransaction,
				runs.exclusive,
				untilStored,
				asNotesError
			)
		}

		// A retired capture id answers with the note it joined, followed through any later joins, or as deleted; none says the id was never retired.
		function retired(
			id: NoteId
		): Effect.Effect<Option.Option<Note>, NotesError | SqlError.SqlError | Schema.SchemaError> {
			return Effect.flatMap(
				findRetired(id),
				Option.match({
					onNone: () => Effect.succeed(Option.none<Note>()),
					onSome: Effect.fnUntraced(function* (row: RetiredNote) {
						const joined = yield* Option.match(row.mergedInto, {
							onNone: () => Effect.succeed(Option.none<Note>()),
							onSome: into =>
								Effect.flatMap(findNote(into), Option.match({onNone: () => retired(into), onSome: Effect.succeedSome}))
						})
						if (Option.isNone(joined)) return yield* removed
						return joined
					})
				})
			)
		}

		const receive = Effect.fnUntraced(function* (
			userId: UserId,
			input: {body: Stream.Stream<Uint8Array, unknown>; id: NoteId; type: FileType}
		) {
			const stored = path.join(
				Boolean.match(isVideo(input.type), {onFalse: () => images, onTrue: () => files}),
				input.id
			)
			const partial = path.join(yield* asNotesError(fs.makeTempDirectoryScoped({directory, prefix: 'upload-'})), 'body')
			yield* pipe(
				input.body,
				Stream.mapError(cause => NotesError.make({cause, message: 'The upload broke off.'})),
				Stream.limitBytes(ByteSize.gibibytes(1), () =>
					Stream.fail(NotesError.make({message: 'The file is larger than 1 GiB.', reason: 'TooLarge'}))
				),
				Stream.run(fs.sink(partial, {mode: 0o600})),
				Effect.catchTag('PlatformError', cause =>
					Effect.fail(NotesError.make({cause, message: 'The upload could not be written.'}))
				)
			)
			const publication = yield* RcMap.get(publications, input.id)
			return yield* pipe(
				Effect.gen(function* () {
					// Removal holds the same permit, so an upload either lands before it or finds its id retired.
					if (Option.isSome(yield* findRetired(input.id))) return yield* removed
					return yield* Option.match(yield* findNote(input.id), {
						onNone: Effect.fnUntraced(function* () {
							yield* asNotesError(fs.rename(partial, stored))
							yield* pipe(
								insertNote(newNote(userId, {id: input.id, text: ''}, Option.none(), Option.some(input.type))),
								asNotesError,
								Effect.onError(() =>
									Effect.ignore(fs.remove(stored, {force: true}), {
										log: 'Warn',
										message: 'An unaccepted upload stays on disk'
									})
								)
							)
						}),
						onSome: () => Effect.void
					})
				}),
				sql.withTransaction,
				Semaphore.withPermit(publication),
				asNotesError
			)
		})

		// The note, or the failure of an id no note has.
		function get(id: NoteId) {
			return Effect.flatMap(findNote(id), Option.match({onNone: () => Effect.fail(missing), onSome: Effect.succeed}))
		}

		return {
			capture: Effect.fn('Notes.capture')(function* (userId: UserId, input: Capture) {
				const text = String.trim(input.text)
				if (String.isEmpty(text)) {
					return yield* NotesError.make({message: 'Paste a link or write a note.', reason: 'Invalid'})
				}
				const url = Option.fromUndefinedOr(captureUrl(text))
				// The note and the work of organizing it commit together, so a request that ends early still leaves it to a worker.
				const id = yield* pipe(
					retired(input.id),
					Effect.flatMap(
						Option.match({
							onNone: Effect.fnUntraced(function* () {
								return yield* Option.match(yield* findSaved({id: input.id, url}), {
									onNone: () => Effect.as(insertNote(newNote(userId, {...input, text}, url, Option.none())), input.id),
									// A share of a saved note adds its new words, unless it is the same capture sent again; only a new share asks a failed note again, so a resend pays for nothing. A capture id that joins another note's link stays retired into it, so its resend after that note's deletion is refused as deleted.
									onSome: Effect.fnUntraced(function* (found: Note) {
										yield* storeChange(found, NoteChange.cases.share.make({capture: {...input, text}}))
										if (found.id !== input.id) yield* retire({id: input.id, mergedInto: Option.some(found.id)})
										if ((found.status === 'failed' || runs.isUnrecorded(found.id)) && found.id !== input.id) {
											yield* changeIn(found.id, NoteChange.cases.retry.make({requester: userId}))
											yield* organizeLater(found.id)
										}
										return found.id
									})
								})
							}),
							onSome: joined => Effect.succeed(joined.id)
						})
					),
					sql.withTransaction,
					asNotesError
				)
				return id
			}, withReactivity),
			captureFile: Effect.fn('Notes.captureFile')(function* (
				userId: UserId,
				input: {body: Stream.Stream<Uint8Array, unknown>; id: NoteId; type: FileType}
			) {
				// A resend of a kept upload answers with its note and a deleted one as deleted, without reading the body again.
				return yield* Option.match(yield* asNotesError(retired(input.id)), {
					onNone: Effect.fnUntraced(function* () {
						if (Option.isNone(yield* findNote(input.id))) yield* Effect.scoped(receive(userId, input))
						return input.id
					}),
					onSome: joined => Effect.succeed(joined.id)
				})
			}, withReactivity),
			change,
			directories: {files, images, root: directory},
			findNote,
			get,
			image: Effect.fn('Notes.image')(function* (id: NoteId) {
				const type = yield* pipe(
					findNote(id),
					Effect.map(Option.flatMap(note => note.image)),
					Effect.flatMap(Effect.fromOption),
					Effect.catchTag('NoSuchElementError', () => NotesError.make({message: 'This note has no preview image.'}))
				)
				return {bytes: yield* asNotesError(fs.readFile(path.join(images, id))), type}
			}),
			organized,
			persist,
			regenerate: Effect.fn('Notes.regenerate')(function* (userId: UserId, id: NoteId) {
				yield* get(id)
				// The save and the stop hold the permit every write of the run waits for. A save that fails, at the write lock or at its commit, leaves the run to store its answer; a committed one stops the run before any of its writes, so what the old run still brings is dropped and no claim starts the note before the run has ended. A caller that goes away at the commit cannot part the two: the save and the stop end together.
				yield* runs.exclusive(
					Effect.uninterruptible(
						pipe(
							changeIn(id, NoteChange.cases.retry.make({requester: userId})),
							Effect.andThen(organizeLater(id)),
							sql.withTransaction,
							asNotesError,
							Effect.andThen(runs.stop(id))
						)
					)
				)
			}, withReactivity),
			remove: Effect.fn('Notes.remove')(
				function* (id: NoteId) {
					// No claim starts the note again between its deletion and the end of its run.
					yield* runs.exclusive(
						// An upload of this id publishes under the same permit, so its file lands before the removal or never.
						Semaphore.withPermit(
							yield* RcMap.get(publications, id),
							Effect.gen(function* () {
								// A deletion that fails leaves the run and the answer it waits to store alone; it holds the permit already, so it does not write as a run does.
								yield* pipe(
									changeIn(id, NoteChange.cases.remove.make({into: Option.none()})),
									sql.withTransaction,
									asNotesError
								)
								yield* runs.forget(id)
								// The run ends before its files go, so it cannot write a preview after them; its stores find no note.
								yield* runs.stop(id)
								yield* removeFiles(id)
							})
						)
					)
				},
				Effect.scoped,
				withReactivity
			),
			// Once the link is resolved: the note takes its canonical link, or joins the note already saved under it, which leaves it with no files; none says it is gone.
			resolved: Effect.fnUntraced(function* (id: NoteId, url: string) {
				return yield* pipe(
					findNote(id),
					Effect.flatMap(
						Option.match({
							onNone: () => Effect.succeed(Option.none<Note>()),
							onSome: Effect.fnUntraced(function* (current: Note) {
								return yield* Option.match(yield* findResolved({id, url}), {
									onNone: () =>
										Effect.andThen(storeChange(current, NoteChange.cases.resolve.make({url})), findNote(id)),
									onSome: Effect.fnUntraced(function* (saved: Note) {
										yield* storeChange(saved, NoteChange.cases.share.make({capture: {id, text: current.text}}))
										yield* storeChange(current, NoteChange.cases.remove.make({into: Option.some(saved.id)}))
										return Option.none<Note>()
									})
								})
							})
						})
					),
					sql.withTransaction,
					runs.exclusive,
					asNotesError,
					Effect.tap(note => Option.match(note, {onNone: () => removeFiles(id), onSome: () => Effect.void}))
				)
			}),
			// The capture id follows a shortened link into the existing note when the resolver joins them.
			saveActivity: (id: NoteId) =>
				Stream.changes(
					reactivity.stream(
						['notes', 'stashProgress'],
						pipe(
							Effect.gen(function* () {
								const note = yield* Option.match(yield* retired(id), {onNone: () => get(id), onSome: Effect.succeed})
								const state = saveState(note)
								if (state.status !== 'organizing') return state
								return Option.match(runs.trackedOf(note.id), {
									onNone: () => state,
									onSome: transcription => ({...state, ...transcription})
								})
							}),
							sql.withTransaction,
							asNotesError
						)
					)
				),
			storeImage,
			tagEntries: listTagEntries
		}
	})
}) {
	static readonly migrations = migrations
	static readonly layer = (directory: string) =>
		Layer.provide(Layer.effect(this, this.make(directory)), this.migrations)
}

export const layerNotes = Layer.unwrap(
	Effect.mapBoth(dataDirectory, {
		onFailure: cause => NotesError.make({cause, message: 'The notes folder could not be read.'}),
		onSuccess: Notes.layer
	})
)
