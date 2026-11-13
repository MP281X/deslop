import {
	Array,
	Boolean,
	ByteSize,
	Cause,
	Context,
	Effect,
	FiberMap,
	FileSystem,
	Layer,
	Match,
	Option,
	Path,
	Random,
	Result,
	Schema,
	Semaphore,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlModel, SqlSchema} from 'effect/sql'

import {dataDirectory} from '@deslop/runtime/server/store'
import type {UserId} from '@deslop/runtime/shared/auth'
import {listEvents} from '@deslop/runtime/shared/list'

import {changeNote, newNote} from './lib/changes.ts'
import type {NoteChange} from './lib/changes.ts'
import {Sources} from './lib/extraction.ts'
import {Organizer} from './lib/organization.ts'
import {reconcileOrganization} from './lib/tags.ts'

import {clock} from '#services/media/lib/utils.ts'
import type {Still} from '#services/media/schema.ts'
import {Media} from '#services/media/service.ts'
import {captureUrl, commentOf, hasVideo, queryWords, sourceOf} from '#services/notes/lib/utils.ts'
import type {Capture, Extraction, FileType, Image, Picture} from '#services/notes/schema.ts'
import {Note, NoteId, NoteItem, NotesCursor, NotesError, NoteTag, Tag, TagEntry} from '#services/notes/schema.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly notes: never
	}
}

function still(frame: Still) {
	return {bytes: frame.bytes, label: `Video still at [${clock(frame.seconds)}]`, type: 'image/jpeg'} satisfies Picture
}

const isVideo = String.startsWith('video/')

function optional<B>(message: string, fallback: () => B) {
	return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		pipe(
			effect,
			Effect.tapError(error => Effect.logWarning(message, error)),
			Effect.orElseSucceed(fallback)
		)
}

function asStorageNotesError(cause: unknown) {
	return NotesError.make({cause, message: 'The notes or their files could not be read or written.'})
}

const asNotesError = Effect.mapError(asStorageNotesError)

const missing = NotesError.make({message: 'No note has this id; find its id with search_notes.'})

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
		const reading = yield* Semaphore.make(2)
		const tagging = yield* Semaphore.make(1)
		const runs = yield* FiberMap.make<NoteId>()
		// Writes tell this Reactivity of their commits, so callers need none of their own.
		const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)

		yield* asNotesError(fs.makeDirectory(images, {mode: 0o700, recursive: true}))
		yield* asNotesError(fs.makeDirectory(files, {mode: 0o700, recursive: true}))

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
					term => sql`instr(lower(concat_ws(' ', title, summary, author, text, content, topics, body, screenText,
						transcript, url, (SELECT group_concat(tag, ' ') FROM note_tags WHERE noteId = notes.id))), ${term}) > 0`
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
						cursor => sql`(createdAt < ${cursor.createdAt} OR (createdAt = ${cursor.createdAt} AND id < ${cursor.id}))`
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
		// A share of a saved link joins its note: the link is canonical before it is saved, so equal links are one note.
		const findSaved = SqlSchema.findOneOption({
			Request: Schema.Struct({id: NoteId, url: Schema.OptionFromNullOr(Schema.String)}),
			Result: Note,
			execute: request => sql`
				SELECT * FROM notes WHERE id = ${request.id} OR url = ${request.url}
				ORDER BY id = ${request.id} DESC
				LIMIT 1
			`
		})
		const listOrganizing = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Note,
			execute: () => sql`SELECT * FROM notes WHERE status = ${'organizing' satisfies Note['status']}`
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

		// The note is read again inside the write, so a change made meanwhile is kept and a note removed meanwhile stays removed.
		function storeChange(note: Note, update: NoteChange) {
			return pipe(
				Match.value(changeNote(note, update)),
				Match.tag('Unchanged', () => Effect.void),
				Match.tag('Removed', () => Reactivity.mutation(notes.delete(note.id), ['notes'])),
				Match.tag('Changed', changed =>
					pipe(
						notes.update(Struct.pick(changed.note, Struct.keys(Note.update.fields))),
						Reactivity.mutation(['notes']),
						Effect.asVoid
					)
				),
				Match.exhaustive
			)
		}

		function change(id: NoteId, update: NoteChange) {
			return pipe(
				Effect.flatMap(
					findNote(id),
					Option.match({onNone: () => Effect.void, onSome: note => storeChange(note, update)})
				),
				sql.withTransaction,
				asNotesError
			)
		}

		const storeImage = Effect.fnUntraced(function* (id: NoteId, image: Image) {
			yield* asNotesError(fs.writeFile(path.join(images, id), image.bytes, {mode: 0o600}))
			yield* change(id, {image: image.type, type: 'image'})
		})

		const writeOrganization = Effect.fnUntraced(function* (
			note: Note,
			found: ReturnType<typeof reconcileOrganization>
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
			yield* storeChange(note, {organization: found.organization, type: 'organize'})
		})

		// The organized note, its tags and their definitions land together or not at all, and watchers hear of it once it commits; a note removed meanwhile stays removed.
		function organized(id: NoteId, found: ReturnType<typeof reconcileOrganization>) {
			return pipe(
				Effect.flatMap(
					findNote(id),
					Option.match({onNone: () => Effect.void, onSome: note => writeOrganization(note, found)})
				),
				sql.withTransaction,
				asNotesError
			)
		}

		const tagNote = Effect.fnUntraced(function* (userId: UserId, note: Note, stills: Picture[]) {
			const label = Boolean.match(Option.isNone(note.file), {
				onFalse: () => 'The saved photo',
				onTrue: () => 'Preview image'
			})
			const preview = yield* optional(
				'The preview could not be read',
				Array.empty<Picture>
			)(
				Effect.forEach(
					Option.toArray(note.image),
					type => Effect.map(fs.readFile(path.join(images, note.id)), bytes => ({bytes, label, type})),
					{concurrency: 'unbounded'}
				)
			)
			const pictures = [...preview, ...stills]
			if (
				String.isEmpty(note.content) &&
				!Option.exists(note.transcript, String.isNonEmpty) &&
				String.isEmpty(commentOf(note.text)) &&
				Array.isReadonlyArrayEmpty(pictures)
			) {
				return yield* change(note.id, {type: 'empty'})
			}
			const entries = yield* asNotesError(listTagEntries())
			yield* Result.match(yield* Effect.result(organizer.organize(userId, {images: pictures, note, tags: entries})), {
				onFailure: error => change(note.id, {message: error.message, type: 'fail'}),
				onSuccess: organization =>
					organized(
						note.id,
						reconcileOrganization(
							organization,
							Array.map(entries, entry => entry.name)
						)
					)
			})
		})

		// One note at a time, so two notes read together cannot create rival tags for the same topic.
		function tag(userId: UserId, id: NoteId, stills: Picture[]) {
			return pipe(
				findNote(id),
				Effect.flatMap(
					Option.match({onNone: () => Effect.void, onSome: note => tagging.withPermit(tagNote(userId, note, stills))})
				),
				Effect.withSpan('Notes.tag', {attributes: {'note.id': id}})
			)
		}

		// TikTok's preview image links expire within days, so the server keeps the image; a regenerated note keeps its own.
		const keepImages = Effect.fnUntraced(function* (note: Note, page: Extraction) {
			yield* pipe(
				Option.toArray(Option.filter(page.image, () => Option.isNone(note.image))),
				Effect.forEach(image => Effect.flatMap(sources.image(image), bytes => storeImage(note.id, bytes)), {
					concurrency: 'unbounded',
					discard: true
				}),
				Effect.ignore({log: 'Warn', message: 'The preview image was not kept'})
			)
			const slides = yield* pipe(
				page.slides,
				Option.toArray,
				Array.flatten,
				Effect.forEach(
					(image, index) =>
						pipe(
							sources.image(image),
							Effect.map(found => Option.some({...found, label: `Image ${index + 2}`})),
							optional('A slide was not read', Option.none<Picture>)
						),
					{concurrency: 4}
				)
			)
			return Array.getSomes(slides)
		})

		// The video's details replace an X post's text only when the post itself could not be read.
		const watch = Effect.fnUntraced(function* (
			userId: UserId,
			note: Note,
			input: {slides: Picture[]; url: string; useInfo: boolean; video: string}
		) {
			// The transcript and the stills each run yt-dlp, so they run side by side; the note shows its transcript before the stills finish.
			const [, frames] = yield* Effect.all(
				[
					pipe(
						media.read(userId, input.url, input.video),
						Effect.asSome,
						optional('The video could not be read', Option.none),
						Effect.flatMap(read =>
							pipe(
								Option.filter(read, () => Option.isNone(note.transcript)),
								Option.map(details => optional('No transcript', Option.none<string>)(details.transcript)),
								Effect.transposeOption,
								Effect.map(Option.flatten),
								Effect.flatMap(transcript =>
									change(note.id, {
										content: pipe(
											read,
											Option.filter(() => sourceOf(input.url) !== 'X' || input.useInfo),
											Option.map(details => details.info)
										),
										transcript,
										type: 'video'
									})
								)
							)
						)
					),
					optional('No video frames', Array.empty<Still>)(media.frames(input.video))
				],
				{concurrency: 2}
			)
			yield* tag(userId, note.id, [...input.slides, ...Array.map(frames, still)])
		})

		const organizeLink = Effect.fnUntraced(function* (userId: UserId, note: Note, link: string) {
			const extraction = yield* Effect.result(sources.extract(link))
			yield* change(note.id, {extraction, type: 'extract'})
			const slides = yield* Result.match(extraction, {
				onFailure: () => Effect.succeed(Array.empty<Picture>()),
				onSuccess: page => keepImages(note, page)
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
			const stills = yield* optional('No video frames', Array.empty<Still>)(media.fileFrames(stored))
			yield* pipe(
				Array.head(stills),
				Option.match({
					onNone: () => Effect.void,
					onSome: frame => storeImage(note.id, {bytes: frame.bytes, type: 'image/jpeg'})
				}),
				Effect.ignore({log: 'Warn', message: 'The video preview was not kept'})
			)
			yield* Option.match(yield* optional('No transcript', Option.none<string>)(media.fileTranscript(userId, stored)), {
				onNone: () => Effect.void,
				onSome: text => change(note.id, {content: Option.none(), transcript: Option.some(text), type: 'video'})
			})
			yield* tag(userId, note.id, pipe(stills, Array.drop(1), Array.map(still)))
		})

		function start(userId: UserId, note: Note) {
			return Effect.flatMap(Effect.option(Effect.currentSpan), request =>
				pipe(
					change(note.id, {requester: userId, type: 'request'}),
					Effect.andThen(
						Option.match(note.file, {
							onNone: () =>
								Option.match(note.url, {
									onNone: () => tag(userId, note.id, []),
									onSome: link => reading.withPermit(organizeLink(userId, note, link))
								}),
							onSome: type => reading.withPermit(organizeFile(userId, note, type))
						})
					),
					Effect.tapCause(cause =>
						Boolean.match(Cause.hasInterruptsOnly(cause), {
							onFalse: () =>
								Effect.ignore(change(note.id, {type: 'stop'}), {
									log: 'Warn',
									message: 'A stopped tagging run could not be recorded'
								}),
							onTrue: () => Effect.void
						})
					),
					// A finished or cancelled capture must not keep its request's trace open; the pipeline links back to it instead.
					Effect.withSpan('Notes.organize', {
						attributes: {'note.id': note.id},
						links: Option.toArray(Option.map(request, span => ({attributes: {'link.type': 'follows-from'}, span}))),
						root: true
					}),
					effect => FiberMap.run(runs, note.id, effect),
					Effect.asVoid
				)
			)
		}

		// A note a restart interrupted resumes for the person who saved it.
		yield* Effect.forEach(yield* asNotesError(listOrganizing()), note => start(note.requester, note), {
			concurrency: 1,
			discard: true
		})

		function savedNote(id: NoteId) {
			return Effect.flatMap(findNote(id), Option.match({onNone: () => Effect.fail(missing), onSome: Effect.succeed}))
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
			const partial = `${stored}.${yield* Random.nextIntBetween(0, 1_000_000_000)}.partial`
			yield* pipe(
				input.body,
				Stream.mapError(cause => NotesError.make({cause, message: 'The upload broke off.'})),
				Stream.limitBytes(ByteSize.gibibytes(1), () =>
					Stream.fail(NotesError.make({message: 'The file is larger than 1 GiB.'}))
				),
				Stream.run(fs.sink(partial, {mode: 0o600})),
				Effect.catchTag('PlatformError', cause =>
					Effect.fail(NotesError.make({cause, message: 'The upload could not be written.'}))
				),
				Effect.andThen(asNotesError(fs.rename(partial, stored))),
				Effect.onError(() =>
					Effect.ignore(fs.remove(partial, {force: true}), {log: 'Warn', message: 'A broken upload stays on disk'})
				)
			)
			return yield* pipe(
				Note.insert.makeEffect(newNote(userId, {id: input.id, text: ''}, Option.none(), Option.some(input.type))),
				Effect.flatMap(notes.insert),
				Reactivity.mutation(['notes']),
				asNotesError
			)
		})

		return {
			body: Effect.fn('Notes.body')(function* (id: NoteId) {
				return Struct.pick(yield* savedNote(id), ['body'])
			}),
			capture: Effect.fn('Notes.capture')(function* (userId: UserId, input: Capture) {
				const text = String.trim(input.text)
				if (String.isEmpty(text)) return yield* NotesError.make({message: 'Paste a link or write a note.'})
				const url = yield* pipe(
					Option.fromUndefinedOr(captureUrl(text)),
					Option.map(link => Effect.catchTag(sources.resolve(link), 'NotesError', () => Effect.succeed(link))),
					Effect.transposeOption
				)
				const saved = yield* pipe(
					findSaved({id: input.id, url}),
					Effect.flatMap(
						Option.match({
							onNone: () =>
								pipe(
									Note.insert.makeEffect(newNote(userId, {...input, text}, url, Option.none())),
									Effect.flatMap(notes.insert),
									Reactivity.mutation(['notes']),
									Effect.map(note => ({fresh: true, note}))
								),
							// A share of a saved note adds its new words, unless it is the same capture sent again.
							onSome: found =>
								Effect.as(storeChange(found, {capture: {...input, text}, type: 'share'}), {fresh: false, note: found})
						})
					),
					sql.withTransaction,
					asNotesError
				)
				const item = yield* savedItem(saved.note.id)
				if (saved.fresh) yield* start(userId, saved.note)
				return item
			}, withReactivity),
			captureFile: Effect.fn('Notes.captureFile')(function* (
				userId: UserId,
				input: {body: Stream.Stream<Uint8Array, unknown>; id: NoteId; type: FileType}
			) {
				if (Option.isSome(yield* findNote(input.id))) return yield* savedItem(input.id)
				const note = yield* receive(userId, input)
				const item = yield* savedItem(input.id)
				yield* start(userId, note)
				return item
			}, withReactivity),
			// What the phone watches: the whole list first, then only what changed, after each commit.
			events: pipe(
				listEvents(sql.reactive(['notes'], listItems())),
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
					Effect.mapError(() => NotesError.make({message: 'This note has no preview image.'}))
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
				const found = yield* asNotesError(pageItems({...words, cursor: input.cursor, limit: input.limit + 1}))
				const total = yield* asNotesError(countMatching(words))
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
			regenerate: Effect.fn('Notes.regenerate')(function* (userId: UserId, id: NoteId) {
				yield* FiberMap.remove(runs, id)
				yield* change(id, {type: 'retry'})
				yield* start(userId, yield* savedNote(id))
			}, withReactivity),
			remove: Effect.fn('Notes.remove')(function* (id: NoteId) {
				yield* FiberMap.remove(runs, id)
				yield* change(id, {type: 'remove'})
				yield* pipe(
					fs.remove(path.join(images, id), {force: true}),
					Effect.andThen(fs.remove(path.join(files, id), {force: true})),
					Effect.mapError(cause =>
						NotesError.make({cause, message: 'The note was deleted, but its saved files could not be removed.'})
					)
				)
			}, withReactivity),
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
