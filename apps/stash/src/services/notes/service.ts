import type {SchemaIssue, Tracer} from 'effect'
import {
	Array,
	Boolean,
	ByteSize,
	Cause,
	Context,
	DateTime,
	Duration,
	Effect,
	Exit,
	Fiber,
	FiberMap,
	FileSystem,
	Function,
	HashSet,
	Layer,
	Match,
	MutableHashMap,
	Option,
	Order,
	Path,
	Queue,
	Ref,
	RcMap,
	Result,
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
import type {Statement} from 'effect/sql'
import {Migrator, SqlClient, SqlError, SqlModel, SqlSchema} from 'effect/sql'

import {dataDirectory} from '@deslop/runtime/server/store'
import type {UserId} from '@deslop/runtime/shared/auth'

import {changeNote, newNote} from './lib/changes.ts'
import {Sources} from './lib/extraction.ts'
import {makeMediaReader} from './lib/media.ts'
import {Organizer} from './lib/organization.ts'
import {reconcileOrganization} from './lib/tags.ts'
import {NoteChange} from './schema.ts'

import {clock} from '#services/media/lib/utils.ts'
import type {MediaError, Still} from '#services/media/schema.ts'
import {Media} from '#services/media/service.ts'
import {captureUrl, commentOf, hasVideo, queryWords, searchable, sourceOf} from '#services/notes/lib/utils.ts'
import type {Capture, Extraction, FileType, Image, Picture, Organization} from '#services/notes/schema.ts'
import {
	Note,
	NoteId,
	NoteItem,
	NoteChangeVersion,
	NotesCursor,
	NotesError,
	NoteTag,
	RetiredNote,
	Tag,
	TagEntry
} from '#services/notes/schema.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly notes: never
	}
}

function still(frame: Still) {
	return {bytes: frame.bytes, label: `Video still at [${clock(frame.seconds)}]`, type: 'image/jpeg'} satisfies Picture
}

const isVideo = String.startsWith('video/')

function asStorageNotesError(
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

const asNotesError = Effect.mapError(asStorageNotesError)

const missing = NotesError.make({message: 'No note has this id; find its id with search_notes.'})

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

// The search row of each note the condition selects, from its texts and tags as `searchable` spells them, so the index and a query fold text alike.
const indexNotes = Effect.fnUntraced(function* (sql: SqlClient.SqlClient, condition: Statement.Fragment) {
	const rows = yield* SqlSchema.findAll({
		Request: Schema.Void,
		Result: Schema.Struct({rowid: Schema.Int, tags: Schema.String, text: Schema.String}),
		execute: () => sql`
			SELECT rowid,
				concat_ws(' ', title, summary, author, text, content, topics, body, screenText, transcript, url) AS text,
				coalesce((SELECT group_concat(tag, ' ') FROM note_tags WHERE noteId = notes.id), '') AS tags
			FROM notes WHERE ${condition}
		`
	})()
	yield* Effect.forEach(
		rows,
		row =>
			Effect.andThen(
				sql`DELETE FROM note_search WHERE rowid = ${row.rowid}`,
				sql`INSERT INTO note_search(rowid, text, tags) VALUES (${row.rowid}, ${searchable(row.text)}, ${searchable(row.tags)})`
			),
		{concurrency: 1, discard: true}
	)
})

export class Notes extends Context.Service<Notes>()('@deslop/stash/services/notes/service/Notes', {
	make: Effect.fnUntraced(function* (directory: string) {
		const sql = yield* SqlClient.SqlClient
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const sources = yield* Sources
		const media = yield* Media
		const organizer = yield* Organizer
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
		const runs = yield* FiberMap.make<NoteId>()
		const mediaReader = yield* makeMediaReader
		// One token per note queued for a worker.
		const ready = yield* Queue.unbounded<void>()
		// A signal only says when to look for organizing notes, so signals sent while a claim runs wait as one.
		const signals = yield* Queue.sliding<void>(1)
		// Claims, starts, stops and removals take turns, so no claim starts a note that is being stopped or deleted.
		const dispatch = yield* Semaphore.make(1)
		// The request each run follows from, kept only to link its trace.
		const requests = MutableHashMap.empty<NoteId, Tracer.Span>()
		// Writes tell this Reactivity of their commits, so callers need none of their own.
		const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)

		yield* asNotesError(fs.makeDirectory(images, {mode: 0o700, recursive: true}))
		yield* asNotesError(fs.makeDirectory(files, {mode: 0o700, recursive: true}))
		function reindex(id: NoteId) {
			return indexNotes(sql, sql`id = ${id}`)
		}

		const notes = yield* SqlModel.makeRepository(Note, {idColumn: 'id', spanPrefix: 'Notes', tableName: Note.table})

		// The list's columns, named by the model, and the note's tags in the order the AI gave them as one JSON array.
		const itemColumns = sql`${sql.csv(Struct.keys(NoteItem.insert.fields))}, (
			SELECT json_group_array(tag) FROM (SELECT tag FROM note_tags WHERE noteId = notes.id ORDER BY position)
		) AS tags`

		// Every #tag is one of the note's tags, and every other word is in its texts or tags.
		function matching(query: {readonly tags: readonly string[]; readonly terms: readonly string[]}) {
			return sql.and([
				...Array.map(
					query.tags,
					name => sql`EXISTS (SELECT 1 FROM note_tags WHERE noteId = notes.id AND tag = ${name})`
				),
				...Array.map(
					query.terms,
					term => sql`notes.rowid IN (
					SELECT rowid FROM note_search WHERE note_search MATCH ${`"${String.replaceAll('"', '""')(term)}"*`}
				)`
				)
			])
		}

		const Query = Schema.Struct({tags: Schema.Array(Schema.String), terms: Schema.Array(Schema.String)})

		const listItems = SqlSchema.findAll({
			Request: Schema.Void,
			Result: NoteItem,
			execute: () => sql`SELECT ${itemColumns} FROM notes ORDER BY createdAt DESC, id DESC`
		})
		const findItem = SqlSchema.findOneOption({
			Request: NoteId,
			Result: NoteItem,
			execute: id => sql`SELECT ${itemColumns} FROM notes WHERE id = ${id}`
		})
		const latestVersion = SqlSchema.findOne({
			Request: Schema.Void,
			Result: Schema.Struct({version: Schema.Int}),
			execute: () => sql`SELECT coalesce(max(version), 0) AS version FROM ${sql(NoteChangeVersion.table)}`
		})
		const listChanges = SqlSchema.findAll({
			Request: Schema.Int,
			Result: NoteChangeVersion,
			execute: version =>
				sql`SELECT id, version FROM ${sql(NoteChangeVersion.table)} WHERE version > ${version} ORDER BY version`
		})
		const changedItems = SqlSchema.findAll({
			Request: Schema.Array(NoteId),
			Result: NoteItem,
			execute: ids => sql`SELECT ${itemColumns} FROM notes WHERE id IN ${sql.in(ids)} ORDER BY createdAt DESC, id DESC`
		})
		const findIds = SqlSchema.findAll({
			Request: Query,
			Result: Schema.Struct(Struct.pick(Note.fields, ['id'])),
			execute: query => sql`SELECT id FROM notes WHERE ${matching(query)} ORDER BY createdAt DESC, id DESC`
		})
		// A page of matching notes, newest first, after the cursor's note.
		const pageItems = SqlSchema.findAll({
			Request: Schema.Struct({...Query.fields, cursor: Schema.OptionFromNullOr(NotesCursor), limit: Schema.Int}),
			Result: NoteItem,
			execute: request => sql`
				SELECT ${itemColumns} FROM notes
				WHERE ${sql.and([
					matching(request),
					...Array.map(
						Array.fromNullishOr(request.cursor),
						// One row-value bound lets SQLite seek the index instead of scanning the newer notes again.
						cursor => sql`(createdAt, id) < (${cursor.createdAt}, ${cursor.id})`
					)
				])}
				ORDER BY createdAt DESC, id DESC
				LIMIT ${request.limit}
			`
		})
		const countMatching = SqlSchema.findOne({
			Request: Query,
			Result: Schema.Struct({count: Schema.Int}),
			execute: query => sql`SELECT count(*) AS count FROM notes WHERE ${matching(query)}`
		})
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
		// The files each kept note owns: a preview or photo in images, an uploaded video in files.
		const listOwners = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Schema.Struct(Struct.pick(Note.fields, ['file', 'id', 'image'])),
			execute: () => sql`SELECT id, file, image FROM notes WHERE file IS NOT NULL OR image IS NOT NULL`
		})
		// A note still organizing is pending work, so a restart or a request that ended early leaves it to be claimed again.
		const Pending = Schema.Struct(Struct.pick(Note.fields, ['createdAt', 'id']))
		const listOrganizing = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Pending,
			execute: () => sql`SELECT createdAt, id FROM notes WHERE status = ${'organizing' satisfies Note['status']}`
		})
		// Organizing notes waiting for a worker.
		const queued = MutableHashMap.empty<NoteId, typeof Pending.Type>()
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

		function change(id: NoteId, update: NoteChange) {
			return pipe(changeIn(id, update), sql.withTransaction, asNotesError)
		}

		// A change that stores a provider's answer or settles the run.
		function persist(id: NoteId, update: NoteChange) {
			return pipe(changeIn(id, update), sql.withTransaction, untilStored, asNotesError)
		}

		// Called in the transaction that leaves the note organizing: once it commits, the claim looks at once and the run links back to this request.
		function organizeLater(id: NoteId) {
			return Effect.flatMap(Effect.option(Effect.currentSpan), request =>
				sql.afterCommit(
					Effect.andThen(
						Effect.sync(() => Option.map(request, span => MutableHashMap.set(requests, id, span))),
						Queue.offer(signals, undefined)
					)
				)
			)
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
				untilStored,
				asNotesError
			)
		}

		const tagNote = Effect.fnUntraced(function* (userId: UserId, note: Note, stills: Picture[]) {
			const label = Boolean.match(Option.isNone(note.file), {
				onFalse: Function.constant('The saved photo'),
				onTrue: Function.constant('Preview image')
			})
			const pictures = [
				...(yield* pipe(
					Option.toArray(note.image),
					Effect.forEach(type => Effect.map(fs.readFile(path.join(images, note.id)), bytes => ({bytes, label, type})), {
						concurrency: 'unbounded'
					}),
					Effect.catch(error =>
						Effect.as(Effect.logWarning('The saved preview could not be read', error), Array.empty<Picture>())
					)
				)),
				...stills
			]
			if (
				String.isEmpty(note.content) &&
				!Option.exists(note.transcript, String.isNonEmpty) &&
				String.isEmpty(commentOf(note.text)) &&
				Array.isReadonlyArrayEmpty(pictures)
			) {
				return yield* persist(note.id, NoteChange.cases.empty.make({}))
			}
			yield* Result.match(
				yield* Effect.result(
					organizer.organize(userId, {images: pictures, note, tags: yield* asNotesError(listTagEntries())})
				),
				{
					// The organizer's message is already safe to show, and some, such as a missing key, say what to do.
					onFailure: error => persist(note.id, NoteChange.cases.fail.make({issue: error.message})),
					onSuccess: organization => organized(note.id, organization, note.text)
				}
			)
		})

		// Haiku calls may overlap; tag definitions and each note's organization still commit atomically.
		function tag(userId: UserId, id: NoteId, stills: Picture[]) {
			return pipe(
				findNote(id),
				Effect.flatMap(Option.match({onNone: () => Effect.void, onSome: note => tagNote(userId, note, stills)})),
				Effect.withSpan('Notes.tag', {attributes: {'note.id': id}})
			)
		}

		// TikTok's preview image links expire within days, so the server keeps the image; a regenerated note keeps its own.
		const keepPreview = Effect.fnUntraced(function* (note: Note, preview: Extraction['image']) {
			yield* Effect.forEach(
				Option.toArray(Option.filter(preview, () => Option.isNone(note.image))),
				image => Effect.flatMap(sources.image(image), bytes => storeImage(note.id, bytes)),
				{concurrency: 'unbounded', discard: true}
			)
		})

		function readSlides(slides: Extraction['slides']) {
			return pipe(
				slides,
				Option.toArray,
				Array.flatten,
				Effect.forEach(
					(image, index) =>
						pipe(
							sources.image(image),
							Effect.map(found => ({...found, label: `Image ${index + 2}`})),
							Effect.tapError(error => Effect.logWarning('A slide was not read', error)),
							Effect.option
						),
					{concurrency: 4}
				),
				Effect.map(Array.getSomes)
			)
		}

		// A media failure is logged; one Gateway refused, whose message says what to do, or one that spent the note's budget also leaves its message on the note, so a note that ends with nothing to read says why.
		function explained(id: NoteId, error: MediaError) {
			if (error.reason === undefined) return Effect.void
			return change(id, NoteChange.cases.issue.make({issue: error.message}))
		}

		function untranscribed(id: NoteId) {
			return (error: MediaError) =>
				pipe(
					Effect.logWarning('No transcript', error),
					Effect.andThen(explained(id, error)),
					Effect.as(Option.none<string>())
				)
		}

		function framesOf(id: NoteId, frames: Effect.Effect<Still[], MediaError>) {
			return Effect.catch(frames, error =>
				pipe(
					Effect.logWarning('No video frames', error),
					Effect.andThen(explained(id, error)),
					Effect.as(Array.empty<Still>())
				)
			)
		}

		// Read video details and frames, then tag the note; details replace content for non-X links, and for X only when useInfo says the post itself could not be read.
		const watch = Effect.fnUntraced(function* (
			userId: UserId,
			note: Note,
			input: {slides: Picture[]; url: string; useInfo: boolean; video: string}
		) {
			// The transcript and the frames each run yt-dlp, so they run concurrently under the note's one media budget; the transcript is stored as soon as it arrives, and tagging waits for both.
			const budget = yield* media.budget
			const [, frames] = yield* Effect.all(
				[
					pipe(
						media.read(budget, userId, input.url, Option.some(input.video)),
						Effect.tapError(error =>
							Effect.andThen(Effect.logWarning('The video could not be read', error), explained(note.id, error))
						),
						Effect.option,
						Effect.flatMap(read =>
							pipe(
								Option.filter(read, () => Option.isNone(note.transcript)),
								Option.map(details => Effect.catchTag(details.transcript, 'MediaError', untranscribed(note.id))),
								Effect.transposeOption,
								Effect.map(Option.flatten),
								Effect.flatMap(transcript =>
									persist(
										note.id,
										NoteChange.cases.video.make({
											content: pipe(
												read,
												Option.filter(() => sourceOf(input.url) !== 'X' || input.useInfo),
												Option.map(details => details.info)
											),
											transcript
										})
									)
								)
							)
						)
					),
					framesOf(note.id, media.frames(budget, input.video))
				],
				{concurrency: 2}
			)
			yield* tag(userId, note.id, [...input.slides, ...Array.map(frames, still)])
		}, Effect.scoped)

		// judge-ignore no-silent-fallback -- Sources.resolve only canonicalizes an already usable shared URL; organizeLink performs content extraction separately, so a logged resolution failure may keep the shared URL.
		const resolveLink = Effect.fnUntraced(function* (id: NoteId, link: string) {
			const url = yield* Effect.catch(sources.resolve(link), error =>
				Effect.as(Effect.logWarning('The short link was not resolved', error), link)
			)
			return yield* pipe(
				findNote(id),
				Effect.flatMap(
					Option.match({
						onNone: () => Effect.succeed(Option.none<Note>()),
						onSome: Effect.fnUntraced(function* (current: Note) {
							return yield* Option.match(yield* findResolved({id, url}), {
								onNone: () => Effect.andThen(storeChange(current, NoteChange.cases.resolve.make({url})), findNote(id)),
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
				asNotesError,
				Effect.tap(note => Option.match(note, {onNone: () => removeFiles(id), onSome: () => Effect.void}))
			)
		})

		// The note as resolved: its canonical link, or the shared one when resolution failed.
		const organizeLink = Effect.fnUntraced(function* (userId: UserId, note: Note, original: string) {
			const link = Option.getOrElse(note.url, () => original)
			const extraction = yield* pipe(
				sources.extract(link),
				Effect.tapError(error => Effect.logWarning('The saved link could not be extracted', error)),
				Effect.result
			)
			yield* change(note.id, NoteChange.cases.extract.make({extraction}))
			const slides = yield* Result.match(extraction, {
				onFailure: () => Effect.succeed(Array.empty<Picture>()),
				onSuccess: Effect.fnUntraced(function* (page) {
					yield* Effect.ignore(keepPreview(note, page.image), {log: 'Warn', message: 'The preview image was not kept'})
					return yield* readSlides(page.slides)
				})
			})
			// A video site can refuse the page reader and still answer yt-dlp; a read X post names its video or has none.
			return yield* pipe(
				extraction,
				Result.match({
					onFailure: () => Option.liftPredicate(link, hasVideo),
					onSuccess: page =>
						Option.orElse(page.video, () =>
							Option.liftPredicate(page.url, address => hasVideo(address) && sourceOf(address) !== 'X')
						)
				}),
				Option.match({
					onNone: () => tag(userId, note.id, slides),
					onSome: video =>
						watch(userId, note, {
							slides,
							url: Result.match(extraction, {onFailure: () => link, onSuccess: page => page.url}),
							useInfo: Result.isFailure(extraction),
							video
						})
				})
			)
		})

		const organizeFile = Effect.fnUntraced(function* (userId: UserId, note: Note, type: FileType) {
			if (!isVideo(type)) return yield* tag(userId, note.id, [])
			const stored = path.join(files, note.id)
			const budget = yield* media.budget
			const [stills] = yield* Effect.all(
				[
					Effect.gen(function* () {
						const frames = yield* framesOf(note.id, media.fileFrames(budget, stored))
						yield* pipe(
							Array.head(frames),
							Option.match({
								onNone: () => Effect.void,
								onSome: frame => storeImage(note.id, {bytes: frame.bytes, type: 'image/jpeg'})
							}),
							Effect.ignore({log: 'Warn', message: 'The video preview was not kept'})
						)
						return frames
					}),
					// A transcript an earlier run committed is reused, so a restart does not pay for it again.
					Option.match(note.transcript, {
						onNone: () =>
							pipe(
								media.fileTranscript(budget, userId, stored),
								Effect.catchTag('MediaError', untranscribed(note.id)),
								Effect.flatMap(
									Option.match({
										onNone: () => Effect.void,
										onSome: text =>
											persist(
												note.id,
												NoteChange.cases.video.make({content: Option.none(), transcript: Option.some(text)})
											)
									})
								)
							),
						onSome: () => Effect.void
					})
				],
				{concurrency: 2}
			)
			yield* tag(userId, note.id, pipe(stills, Array.drop(1), Array.map(still)))
		}, Effect.scoped)

		// A worker reads the note again when it starts, so a note deleted, finished or asked again while it waited runs as it is now.
		function organize(id: NoteId) {
			return Effect.suspend(() => {
				const request = MutableHashMap.get(requests, id)
				MutableHashMap.remove(requests, id)
				return pipe(
					findNote(id),
					Effect.flatMap(
						Option.match({
							onNone: () => Effect.void,
							onSome: note =>
								Boolean.match(note.status === 'organizing', {
									onFalse: () => Effect.void,
									onTrue: () =>
										Option.match(note.file, {
											onNone: () =>
												Option.match(note.url, {
													onNone: () => tag(note.requester, note.id, []),
													// Skip organization when resolution finds no remaining note, including after merging a duplicate.
													onSome: link =>
														Effect.flatMap(
															resolveLink(note.id, link),
															Option.match({
																onNone: () => Effect.void,
																onSome: resolved => organizeLink(note.requester, resolved, link)
															})
														)
												}),
											onSome: type => organizeFile(note.requester, note, type)
										})
								})
						})
					),
					// A run that ends without settling its note, failed or not, marks it failed, so while the server runs no claim asks the provider again: one request per run. A restart cuts a run short and the next start asks again, so a charge can repeat. Only a stop or removal interrupts the write.
					Effect.onExit(exit =>
						Boolean.match(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause), {
							onFalse: () =>
								Effect.ignore(Effect.interruptible(persist(id, NoteChange.cases.stop.make({}))), {
									log: 'Warn',
									message: 'A stopped tagging run could not be recorded'
								}),
							onTrue: () => Effect.void
						})
					),
					// A finished or cancelled capture must not keep its request's trace open; the pipeline links back to it instead.
					Effect.withSpan('Notes.organize', {
						attributes: {'note.id': id},
						links: Option.toArray(Option.map(request, span => ({attributes: {'link.type': 'follows-from'}, span}))),
						root: true
					})
				)
			})
		}

		// A crash can leave an upload half received, a published file whose row never committed, a preview without its row's mark, or a deleted note's files; at start only files a kept note owns stay.
		const owners = yield* asNotesError(listOwners())
		const sweep = Effect.fnUntraced(function* (folder: string, keep: (name: string) => boolean) {
			yield* pipe(
				yield* fs.readDirectory(folder),
				Array.filter(name => !keep(name)),
				Effect.forEach(name => fs.remove(path.join(folder, name), {force: true, recursive: true}), {
					concurrency: 'unbounded',
					discard: true
				})
			)
		})
		const previews = HashSet.fromIterable(
			pipe(
				owners,
				Array.filter(owner => Option.isSome(owner.image)),
				Array.map(owner => owner.id)
			)
		)
		const videos = HashSet.fromIterable(
			pipe(
				owners,
				Array.filter(owner => Option.exists(owner.file, isVideo)),
				Array.map(owner => owner.id)
			)
		)
		yield* asNotesError(
			Effect.all(
				[
					sweep(images, name => HashSet.has(previews, name)),
					sweep(files, name => HashSet.has(videos, name)),
					sweep(directory, name => !String.startsWith('upload-')(name))
				],
				{concurrency: 'unbounded'}
			)
		)

		// Queues every organizing note this server is neither queuing nor running, so repeated signals and scans start each note once.
		const claim = Semaphore.withPermit(
			dispatch,
			Effect.gen(function* () {
				const fresh = Array.filter(
					yield* asNotesError(listOrganizing()),
					note => !MutableHashMap.has(queued, note.id) && !FiberMap.hasUnsafe(runs, note.id)
				)
				yield* Effect.forEach(
					fresh,
					note =>
						Effect.andThen(
							Effect.sync(() => MutableHashMap.set(queued, note.id, note)),
							Queue.offer(ready, undefined)
						),
					{concurrency: 1, discard: true}
				)
			})
		)
		// A commit that leaves a note organizing signals at once; the scan at start and each minute also claims a note whose signal was lost.
		yield* pipe(
			Stream.merge(Stream.tick('1 minute'), Stream.fromQueue(signals)),
			Stream.runForEach(() =>
				Effect.catch(claim, error => Effect.logWarning('The notes waiting to be organized could not be read', error))
			),
			Effect.forkScoped
		)

		// Workers choose only when free, so fresh captures jump ahead of the resumed backlog.
		const start = Semaphore.withPermit(
			dispatch,
			Effect.suspend(() =>
				Array.match(Array.fromIterable(MutableHashMap.values(queued)), {
					onEmpty: () => Effect.succeedNone,
					onNonEmpty: waiting => {
						const next = Array.max(waiting, Order.Struct({createdAt: DateTime.Order, id: Order.String}))
						MutableHashMap.remove(queued, next.id)
						return Effect.asSome(FiberMap.run(runs, next.id, organize(next.id)))
					}
				})
			)
		)
		const work = Effect.andThen(
			Queue.take(ready),
			Effect.flatMap(start, run => Effect.forEach(Option.toArray(run), Fiber.await, {concurrency: 1, discard: true}))
		)
		yield* Effect.forEach(Array.range(1, 8), () => pipe(work, Effect.forever, Effect.forkScoped), {
			concurrency: 1,
			discard: true
		})

		function savedNote(id: NoteId) {
			return Effect.flatMap(findNote(id), Option.match({onNone: () => Effect.fail(missing), onSome: Effect.succeed}))
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

		// The note just saved, or the one it joined, as the list shows it.
		function savedItem(id: NoteId) {
			return Effect.flatMap(
				asNotesError(findItem(id)),
				Option.match({onNone: () => Effect.fail(missing), onSome: Effect.succeed})
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

		return {
			body: Effect.fn('Notes.body')(function* (id: NoteId) {
				return Struct.pick(yield* savedNote(id), ['body'])
			}),
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
										if (found.status === 'failed' && found.id !== input.id) {
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
				return yield* savedItem(id)
			}, withReactivity),
			captureFile: Effect.fn('Notes.captureFile')(function* (
				userId: UserId,
				input: {body: Stream.Stream<Uint8Array, unknown>; id: NoteId; type: FileType}
			) {
				// A resend of a kept upload answers with its note and a deleted one as deleted, without reading the body again.
				return yield* Option.match(yield* asNotesError(retired(input.id)), {
					onNone: Effect.fnUntraced(function* () {
						if (Option.isNone(yield* findNote(input.id))) yield* Effect.scoped(receive(userId, input))
						return yield* savedItem(input.id)
					}),
					onSome: joined => savedItem(joined.id)
				})
			}, withReactivity),
			// What the phone watches: the whole list first, then only what changed, after each commit.
			events: pipe(
				Stream.unwrap(
					Effect.gen(function* () {
						const cursor = yield* Ref.make(Option.none<number>())
						return pipe(
							sql.reactive(['notes'], Effect.void),
							// Commits a slow reader has not caught up with wait as one, since the next read takes every change after its cursor.
							Stream.buffer({capacity: 1, strategy: 'sliding'}),
							Stream.mapEffect(() =>
								sql.withTransaction(
									Effect.gen(function* () {
										const previous = yield* Ref.get(cursor)
										const reset = Option.isNone(previous)
										// A reset sends every note, so it reads only the newest version, not every change and tombstone before it.
										const changes = yield* Option.match(previous, {
											onNone: () => Effect.succeed(Array.empty<NoteChangeVersion>()),
											onSome: listChanges
										})
										const version = yield* Option.match(Array.last(changes), {
											onNone: () =>
												Option.match(previous, {
													onNone: () => Effect.map(latestVersion(), row => row.version),
													onSome: Effect.succeed
												}),
											onSome: row => Effect.succeed(row.version)
										})
										const items = yield* Boolean.match(reset, {
											onFalse: () => changedItems(Array.map(changes, row => row.id)),
											onTrue: () => listItems()
										})
										const present = HashSet.fromIterable(Array.map(items, item => item.id))
										yield* Ref.set(cursor, Option.some(version))
										return {
											removed: pipe(
												changes,
												Array.filter(row => !HashSet.has(present, row.id)),
												Array.map(row => row.id)
											),
											reset,
											upserted: items
										}
									})
								)
							)
						)
					})
				),
				Stream.filter(
					event =>
						event.reset || Array.isReadonlyArrayNonEmpty(event.upserted) || Array.isReadonlyArrayNonEmpty(event.removed)
				),
				Stream.mapError(asStorageNotesError),
				Stream.withSpan('Notes.events', {attributes: {'rpc.stream': true}})
			),
			get: Effect.fn('Notes.get')(function* (id: NoteId) {
				return yield* savedNote(id)
			}),
			image: Effect.fn('Notes.image')(function* (id: NoteId) {
				const type = yield* pipe(
					findNote(id),
					Effect.map(Option.flatMap(note => note.image)),
					Effect.flatMap(Effect.fromOption),
					Effect.catchTag('NoSuchElementError', () => NotesError.make({message: 'This note has no preview image.'}))
				)
				return {bytes: yield* asNotesError(fs.readFile(path.join(images, id))), type}
			}),
			item: Effect.fn('Notes.item')(savedItem),
			// A page of the notes matching a query, newest first, and how many match in all.
			list: Effect.fn('Notes.list')(function* (input: {
				cursor: Option.Option<NotesCursor>
				limit: number
				query: string
			}) {
				const words = queryWords(input.query)
				// The page and its total come from one short read, so a deletion between them cannot disagree.
				const [found, total] = yield* pipe(
					Effect.all([pageItems({...words, cursor: input.cursor, limit: input.limit + 1}), countMatching(words)], {
						concurrency: 1
					}),
					sql.withTransaction,
					asNotesError
				)
				const page = Array.take(found, input.limit)
				return {
					items: page,
					next: pipe(
						Array.last(page),
						Option.filter(() => found.length > input.limit),
						Option.map(note => NotesCursor.make({createdAt: note.createdAt, id: note.id}))
					),
					total: total.count
				}
			}),
			// How many pictures the note's post shows, read from its source now; a note without a link has none.
			media: Effect.fn('Notes.media')(function* (id: NoteId) {
				return yield* pipe(
					findNote(id),
					Effect.map(Option.flatMap(note => note.url)),
					Effect.flatMap(Option.match({onNone: () => Effect.succeed(0), onSome: mediaReader.count}))
				)
			}),
			mediaFile: Effect.fn('Notes.mediaFile')(function* (id: NoteId, index: number) {
				const link = yield* pipe(
					findNote(id),
					Effect.map(Option.flatMap(note => note.url)),
					Effect.flatMap(Effect.fromOption),
					Effect.catchTag('NoSuchElementError', () => NotesError.make({message: 'This note has no media.'}))
				)
				return yield* mediaReader.file(link, index)
			}),
			regenerate: Effect.fn('Notes.regenerate')(function* (userId: UserId, id: NoteId) {
				yield* savedNote(id)
				// A run in progress stops before the note starts over, and no claim starts it in between.
				yield* Semaphore.withPermit(
					dispatch,
					Effect.andThen(
						FiberMap.remove(runs, id),
						pipe(
							changeIn(id, NoteChange.cases.retry.make({requester: userId})),
							Effect.andThen(organizeLater(id)),
							sql.withTransaction,
							asNotesError
						)
					)
				)
			}, withReactivity),
			remove: Effect.fn('Notes.remove')(
				function* (id: NoteId) {
					const publication = yield* RcMap.get(publications, id)
					// No claim starts the note again between stopping its run and deleting it.
					yield* Semaphore.withPermit(
						dispatch,
						Effect.gen(function* () {
							MutableHashMap.remove(queued, id)
							MutableHashMap.remove(requests, id)
							yield* FiberMap.remove(runs, id)
							// An upload of this id publishes under the same permit, so its file lands before the removal or never.
							yield* Semaphore.withPermit(
								publication,
								Effect.andThen(change(id, NoteChange.cases.remove.make({into: Option.none()})), removeFiles(id))
							)
						})
					)
				},
				Effect.scoped,
				withReactivity
			),
			// The ids matching a query, read again after each commit; `#word` names a tag.
			search: (query: string) =>
				pipe(
					sql.reactive(
						['notes'],
						Effect.map(
							findIds(queryWords(query)),
							Array.map(row => row.id)
						)
					),
					// A slow reader gets only the newest matches.
					Stream.buffer({capacity: 1, strategy: 'sliding'}),
					Stream.changes,
					Stream.mapError(asStorageNotesError),
					Stream.withSpan('Notes.search', {attributes: {'rpc.stream': true}})
				)
		}
	})
}) {
	// The tables this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({
			loader: Migrator.fromRecord({
				'0001_notes': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`
						CREATE TABLE notes (
							id TEXT PRIMARY KEY,
							createdAt INTEGER NOT NULL,
							requester TEXT NOT NULL,
							source TEXT NOT NULL,
							status TEXT NOT NULL,
							title TEXT NOT NULL,
							summary TEXT NOT NULL,
							text TEXT NOT NULL,
							content TEXT NOT NULL,
							author TEXT,
							body TEXT,
							file TEXT,
							image TEXT,
							issue TEXT,
							screenText TEXT,
							topics TEXT,
							transcript TEXT,
							url TEXT
						) STRICT
					`
					yield* sql`CREATE INDEX notes_by_created ON notes (createdAt, id)`
					yield* sql`CREATE INDEX notes_by_url ON notes (url)`
					yield* sql`CREATE TABLE tags (name TEXT PRIMARY KEY, definition TEXT) STRICT`
					yield* sql`
						CREATE TABLE note_tags (
							noteId TEXT NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
							tag TEXT NOT NULL REFERENCES tags (name),
							position INTEGER NOT NULL,
							PRIMARY KEY (noteId, tag)
						) STRICT, WITHOUT ROWID
					`
					yield* sql`CREATE INDEX note_tags_by_tag ON note_tags (tag)`
				}),
				'0002_search_changes': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`CREATE VIRTUAL TABLE note_search USING fts5(text, tags, tokenize = 'unicode61')`
					yield* sql`INSERT INTO note_search(rowid, text, tags)
						SELECT rowid, concat_ws(' ', title, summary, author, text, content, topics, body, screenText, transcript, url),
							(SELECT group_concat(tag, ' ') FROM note_tags WHERE noteId = notes.id) FROM notes`
					yield* sql`CREATE TABLE note_changes (id TEXT PRIMARY KEY, version INTEGER NOT NULL) STRICT`
					yield* sql`CREATE INDEX note_changes_by_version ON note_changes(version)`
					yield* sql`CREATE TRIGGER notes_insert AFTER INSERT ON notes BEGIN
						INSERT INTO note_search(rowid, text, tags) VALUES(new.rowid,
							concat_ws(' ', new.title, new.summary, new.author, new.text, new.content, new.topics, new.body, new.screenText, new.transcript, new.url), '');
						INSERT INTO note_changes(id, version) VALUES(new.id, (SELECT coalesce(max(version), 0) + 1 FROM note_changes))
							ON CONFLICT(id) DO UPDATE SET version = excluded.version;
					END`
					yield* sql`CREATE TRIGGER notes_update AFTER UPDATE ON notes BEGIN
						UPDATE note_search SET text = concat_ws(' ', new.title, new.summary, new.author, new.text, new.content, new.topics, new.body, new.screenText, new.transcript, new.url) WHERE rowid = new.rowid;
						INSERT INTO note_changes(id, version) VALUES(new.id, (SELECT coalesce(max(version), 0) + 1 FROM note_changes))
							ON CONFLICT(id) DO UPDATE SET version = excluded.version;
					END`
					yield* sql`CREATE TRIGGER notes_delete AFTER DELETE ON notes BEGIN
						DELETE FROM note_search WHERE rowid = old.rowid;
						INSERT INTO note_changes(id, version) VALUES(old.id, (SELECT coalesce(max(version), 0) + 1 FROM note_changes))
							ON CONFLICT(id) DO UPDATE SET version = excluded.version;
					END`
					yield* sql`CREATE TRIGGER note_tags_insert AFTER INSERT ON note_tags BEGIN
						UPDATE note_search SET tags = (SELECT group_concat(tag, ' ') FROM note_tags WHERE noteId = new.noteId)
							WHERE rowid = (SELECT rowid FROM notes WHERE id = new.noteId);
						INSERT INTO note_changes(id, version) VALUES(new.noteId, (SELECT coalesce(max(version), 0) + 1 FROM note_changes))
							ON CONFLICT(id) DO UPDATE SET version = excluded.version;
					END`
					yield* sql`CREATE TRIGGER note_tags_delete AFTER DELETE ON note_tags BEGIN
						UPDATE note_search SET tags = (SELECT group_concat(tag, ' ') FROM note_tags WHERE noteId = old.noteId)
							WHERE rowid = (SELECT rowid FROM notes WHERE id = old.noteId);
						INSERT INTO note_changes(id, version) VALUES(old.noteId, (SELECT coalesce(max(version), 0) + 1 FROM note_changes))
							ON CONFLICT(id) DO UPDATE SET version = excluded.version;
					END`
				}),
				'0003_retired_notes': Effect.flatMap(
					SqlClient.SqlClient,
					sql => sql`CREATE TABLE retired_notes (id TEXT PRIMARY KEY, mergedInto TEXT) STRICT`
				),
				// The service writes each search row from text `searchable` folds, so the triggers keep only the change versions.
				'0004_searchable_text': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* Effect.forEach(
						[
							{event: 'INSERT', note: 'new.id', table: 'notes', trigger: 'notes_insert'},
							{event: 'UPDATE', note: 'new.id', table: 'notes', trigger: 'notes_update'},
							{event: 'INSERT', note: 'new.noteId', table: 'note_tags', trigger: 'note_tags_insert'},
							{event: 'DELETE', note: 'old.noteId', table: 'note_tags', trigger: 'note_tags_delete'}
						],
						change =>
							Effect.andThen(
								sql`DROP TRIGGER ${sql(change.trigger)}`,
								sql`CREATE TRIGGER ${sql(change.trigger)} AFTER ${sql.literal(change.event)} ON ${sql(change.table)} BEGIN
									INSERT INTO note_changes(id, version) VALUES(${sql.literal(change.note)}, (SELECT coalesce(max(version), 0) + 1 FROM note_changes))
										ON CONFLICT(id) DO UPDATE SET version = excluded.version;
								END`
							),
						{concurrency: 1, discard: true}
					)
					yield* sql`DELETE FROM note_search`
					yield* indexNotes(sql, sql`1 = 1`)
				})
			}),
			table: 'notes_migrations'
		})
	)

	static readonly layer = (directory: string) =>
		Layer.provide(Layer.effect(this, this.make(directory)), this.migrations)
}

// Reading sources and organizing notes are the notes' own internals; tests provide stand-ins to `Notes.layer` instead.
export const layerNotes = Layer.provide(
	Layer.unwrap(
		Effect.mapBoth(dataDirectory, {
			onFailure: cause => NotesError.make({cause, message: 'The notes folder could not be read.'}),
			onSuccess: Notes.layer
		})
	),
	Layer.mergeAll(Sources.layer, Organizer.layer)
)
