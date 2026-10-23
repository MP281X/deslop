// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect has no client for Node's built-in SQLite.
import {DatabaseSync} from 'node:sqlite'

import {Effect, Schema, pipe} from 'effect'

import {diff} from '#services/notes/lib/utils.ts'
import type {Note} from '#services/notes/schema.ts'
import {NoteJson, NotesError, TagDefinition} from '#services/notes/schema.ts'

const failed = Effect.mapError((cause: unknown) => NotesError.make({cause, message: 'The notes database failed.'}))

export const openStore = Effect.fnUntraced(function* (path: string) {
	const database = yield* Effect.acquireRelease(
		pipe(
			Effect.try(() => {
				const opened = new DatabaseSync(path)
				opened.exec(
					'pragma journal_mode = wal; create table if not exists notes (id text primary key, created_at real not null, json text not null); create table if not exists tags (tag text primary key, definition text not null)'
				)
				return opened
			}),
			failed
		),
		opened => Effect.sync(() => opened.close())
	)
	const upsert = database.prepare(
		'insert into notes (id, created_at, json) values (?, ?, ?) on conflict (id) do update set created_at = excluded.created_at, json = excluded.json'
	)
	const remove = database.prepare('delete from notes where id = ?')
	// A tag keeps its first definition, so its meaning stays stable for every later entry.
	const define = database.prepare('insert into tags (tag, definition) values (?, ?) on conflict (tag) do nothing')

	const definitions = pipe(
		Effect.try(() => database.prepare('select tag, definition from tags').all()),
		Effect.flatMap(rows => Schema.decodeUnknownEffect(Schema.Array(TagDefinition))(rows)),
		failed
	)

	const saveDefinitions = Effect.fnUntraced(function* (entries: TagDefinition[]) {
		yield* pipe(
			Effect.try(() => {
				for (const entry of entries) define.run(entry.tag, entry.definition)
			}),
			failed
		)
	})

	const load = pipe(
		Effect.try(() => database.prepare('select json from notes order by created_at desc').all()),
		Effect.flatMap(
			Effect.forEach(row => Schema.decodeUnknownEffect(NoteJson)(row['json']), {concurrency: 'unbounded'})
		),
		failed
	)

	const save = Effect.fnUntraced(function* (previous: Note[], next: Note[]) {
		const changes = diff(previous, next)
		const rows = yield* pipe(
			Effect.forEach(
				changes.upserted,
				note => Effect.map(Schema.encodeEffect(NoteJson)(note), json => ({json, note})),
				{concurrency: 'unbounded'}
			),
			failed
		)
		yield* pipe(
			Effect.try(() => {
				database.exec('begin')
				try {
					for (const row of rows) upsert.run(row.note.id, row.note.createdAt, row.json)
					for (const id of changes.removed) remove.run(id)
					database.exec('commit')
				} catch (error) {
					database.exec('rollback')
					throw error
				}
			}),
			failed
		)
	})

	return {definitions, load, save, saveDefinitions}
})
