import {
	Array,
	Boolean,
	Cache,
	Context,
	Duration,
	Effect,
	Exit,
	Function,
	HashSet,
	Layer,
	Option,
	Ref,
	Schema,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {SqlClient, SqlSchema} from 'effect/sql'

import {queryWords} from '#notes/content.ts'
import {NoteChangeVersion, NoteId, NoteItem, NotesCursor, NotesError} from '#notes/contract.ts'
import {Notes, asNotesError, asStorageNotesError, missing} from '#notes/server.ts'
import {Sources} from '#sources/server.ts'

// A source that failed is asked again soon.
function lifetime<A, E>(exit: Exit.Exit<A, E>) {
	return Boolean.match(Exit.isSuccess(exit), {
		onFalse: Function.constant(Duration.seconds(10)),
		onTrue: Function.constant(Duration.minutes(5))
	})
}

// What the person reads of the notes: the list and its changes, a note's text, and the pictures its post shows.
export class Listing extends Context.Service<Listing>()('@deslop/stash/listing/server/Listing', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const notes = yield* Notes
		const sources = yield* Sources
		// The server keeps no pictures on disk: what a post shows is read from its source when a note opens and held in memory for a few minutes, so the phone's requests for its pictures share one read.
		const lists = yield* Cache.makeWith(sources.photos, {capacity: 32, timeToLive: lifetime})
		// A residential exit is sometimes offline, so a picture gets two more tries, each from another address.
		const pictures = yield* Cache.makeWith(
			(url: string) => Effect.retry(sources.image(url), {times: 2, while: error => error.reason === 'Unreachable'}),
			{capacity: 32, timeToLive: lifetime}
		)
		const mediaReader = {
			count: Effect.fnUntraced(function* (link: string) {
				return (yield* Cache.get(lists, link)).length
			}),
			file: Effect.fnUntraced(function* (link: string, index: number) {
				const url = yield* pipe(
					lists,
					Cache.get(link),
					Effect.flatMap(list =>
						pipe(
							Array.get(list, index),
							Effect.fromOption,
							Effect.mapError(() => NotesError.make({message: 'This note has no such picture.'}))
						)
					)
				)
				return yield* Cache.get(pictures, url)
			})
		}
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
		// The note just saved, or the one it joined, as the list shows it.
		function savedItem(id: NoteId) {
			return Effect.flatMap(
				asNotesError(findItem(id)),
				Option.match({onNone: () => Effect.fail(missing), onSome: Effect.succeed})
			)
		}

		return {
			body: Effect.fn('Listing.body')(function* (id: NoteId) {
				return Struct.pick(yield* notes.get(id), ['body'])
			}),
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
			item: Effect.fn('Listing.item')(savedItem),
			// A page of the notes matching a query, newest first, and how many match in all.
			list: Effect.fn('Listing.list')(function* (input: {
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
			media: Effect.fn('Listing.media')(function* (id: NoteId) {
				return yield* pipe(
					notes.findNote(id),
					Effect.map(Option.flatMap(note => note.url)),
					Effect.flatMap(Option.match({onNone: () => Effect.succeed(0), onSome: mediaReader.count}))
				)
			}),
			mediaFile: Effect.fn('Listing.mediaFile')(function* (id: NoteId, index: number) {
				const link = yield* pipe(
					notes.findNote(id),
					Effect.map(Option.flatMap(note => note.url)),
					Effect.flatMap(Effect.fromOption),
					Effect.catchTag('NoSuchElementError', () => NotesError.make({message: 'This note has no media.'}))
				)
				return yield* mediaReader.file(link, index)
			})
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
