// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect has no client for Node's built-in SQLite, and the notes need writes of one row, not one file.
import {DatabaseSync} from 'node:sqlite'

import {Array, Effect, HashMap, HashSet, Option, Order, Schema, pipe} from 'effect'

import {AiSpend, Note, NotesError, NotesState} from '#services/notes/schema.ts'

type NoteJson = typeof NoteJson.Type
const NoteJson = Schema.fromJsonString(Note)

type AiSpendJson = typeof AiSpendJson.Type
const AiSpendJson = Schema.fromJsonString(AiSpend)

const failed = Effect.mapError((cause: unknown) => NotesError.make({cause, message: 'The notes database failed.'}))

// The notes live in SQLite, one row each, so a change writes only the notes it touched; thousands of notes with
// transcripts would make a single file rewrite take seconds.
export const openStore = Effect.fnUntraced(function* (path: string) {
	const database = yield* Effect.acquireRelease(
		pipe(
			Effect.try(() => {
				const opened = new DatabaseSync(path)
				opened.exec(
					'pragma journal_mode = wal; create table if not exists notes (id text primary key, created_at real not null, json text not null); create table if not exists meta (key text primary key, json text not null)'
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
	const writeMeta = database.prepare(
		'insert into meta (key, json) values (?, ?) on conflict (key) do update set json = excluded.json'
	)

	// Every note, newest first, as the list shows them.
	const load = Effect.gen(function* () {
		const rows = yield* pipe(
			Effect.try(() => database.prepare('select json from notes').all()),
			failed
		)
		const notes = yield* pipe(
			Effect.forEach(rows, row => Schema.decodeUnknownEffect(NoteJson)(row['json'])),
			failed
		)
		const spend = yield* pipe(
			Effect.try(() => database.prepare("select json from meta where key = 'aiSpend'").get()),
			failed
		)
		const aiSpend = yield* Option.match(Option.fromNullishOr(spend), {
			onNone: () => Effect.succeed({month: '', usd: 0}),
			onSome: row => pipe(Schema.decodeUnknownEffect(AiSpendJson)(row['json']), failed)
		})
		return NotesState.make({
			aiSpend,
			notes: Array.sort(notes, Order.flip(Order.mapInput(Order.Number, (note: Note) => note.createdAt)))
		})
	})

	// Writes the notes whose objects changed, deletes the ones that went away, and the AI spend, in one transaction.
	const save = Effect.fnUntraced(function* (previous: NotesState, next: NotesState) {
		const before = HashMap.fromIterable(Array.map(previous.notes, note => [note.id, note] as const))
		const after = HashSet.fromIterable(Array.map(next.notes, note => note.id))
		const encoded = yield* pipe(
			Effect.forEach(
				Array.filter(next.notes, note => !Option.exists(HashMap.get(before, note.id), old => old === note)),
				note => Effect.map(Schema.encodeEffect(NoteJson)(note), json => ({json, note}))
			),
			failed
		)
		const gone = Array.filter(Array.fromIterable(HashMap.keys(before)), id => !HashSet.has(after, id))
		const spend = yield* pipe(Schema.encodeEffect(AiSpendJson)(next.aiSpend), failed)
		yield* pipe(
			Effect.try(() => {
				database.exec('begin')
				try {
					for (const row of encoded) upsert.run(row.note.id, row.note.createdAt, row.json)
					for (const id of gone) remove.run(id)
					if (previous.aiSpend !== next.aiSpend) writeMeta.run('aiSpend', spend)
					database.exec('commit')
				} catch (error) {
					database.exec('rollback')
					throw error
				}
			}),
			failed
		)
	})

	return {load, save}
})
