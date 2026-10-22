// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect has no client for Node's built-in SQLite.
import {DatabaseSync} from 'node:sqlite'

import {Array, Effect, Schema, pipe} from 'effect'

import type {Chapter, PushToken} from '#services/chapters/schema.ts'
import {ChapterJson, ChaptersError} from '#services/chapters/schema.ts'

const failed = Effect.mapError((cause: unknown) =>
	ChaptersError.make({cause, message: 'The chapters database failed.'})
)

export const openStore = Effect.fnUntraced(function* (path: string) {
	const database = yield* Effect.acquireRelease(
		pipe(
			Effect.try(() => {
				const opened = new DatabaseSync(path)
				opened.exec(
					'pragma journal_mode = wal; create table if not exists chapters (number real primary key, json text not null); create table if not exists devices (token text primary key)'
				)
				return opened
			}),
			failed
		),
		opened => Effect.sync(() => opened.close())
	)
	const upsert = database.prepare(
		'insert into chapters (number, json) values (?, ?) on conflict (number) do update set json = excluded.json'
	)
	const addDevice = database.prepare('insert into devices (token) values (?) on conflict (token) do nothing')
	const removeDevice = database.prepare('delete from devices where token = ?')

	const load = pipe(
		Effect.try(() => database.prepare('select json from chapters order by number').all()),
		Effect.flatMap(
			Effect.forEach(row => Schema.decodeUnknownEffect(ChapterJson)(row['json']), {concurrency: 'unbounded'})
		),
		failed
	)

	const save = Effect.fnUntraced(function* (chapters: Chapter[]) {
		const rows = yield* pipe(
			Effect.forEach(
				chapters,
				chapter => Effect.map(Schema.encodeEffect(ChapterJson)(chapter), json => ({chapter, json})),
				{concurrency: 'unbounded'}
			),
			failed
		)
		yield* pipe(
			Effect.try(() => {
				database.exec('begin')
				try {
					for (const row of rows) upsert.run(row.chapter.number, row.json)
					database.exec('commit')
				} catch (error) {
					database.exec('rollback')
					throw error
				}
			}),
			failed
		)
	})

	const devices = pipe(
		Effect.try(() => database.prepare('select token from devices').all()),
		Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({token: Schema.String})))),
		Effect.map(Array.map(row => row.token)),
		failed
	)

	return {
		addDevice: Effect.fnUntraced(function* (token: PushToken) {
			yield* pipe(
				Effect.try(() => addDevice.run(token)),
				failed
			)
		}),
		devices,
		load,
		removeDevice: Effect.fnUntraced(function* (token: string) {
			yield* pipe(
				Effect.try(() => removeDevice.run(token)),
				failed
			)
		}),
		save
	}
})
