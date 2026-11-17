import {SqliteClient} from '@effect/sql-sqlite-node'

import {Config, Duration, Effect, FileSystem, Layer, Option, Path, Schedule, pipe} from 'effect'
import type {PlatformError} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient} from 'effect/sql'

import {appName, packageRoot} from '#server/package.ts'

// A checkout holds `pnpm-workspace.yaml` at its root; an npm installation has none above it.
const checkoutRoot = Effect.fnUntraced(function* (
	directory: string
): Effect.fn.Return<Option.Option<string>, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> {
	const path = yield* Path.Path
	if (yield* (yield* FileSystem.FileSystem).exists(path.join(directory, 'pnpm-workspace.yaml'))) {
		return Option.some(directory)
	}
	if (path.dirname(directory) === directory) return Option.none()
	return yield* checkoutRoot(path.dirname(directory))
})

export const dataDirectory = Effect.gen(function* () {
	const path = yield* Path.Path
	const name = yield* appName
	const directory = yield* Option.match(yield* checkoutRoot(packageRoot), {
		onNone: () => Effect.map(Config.String('HOME'), home => path.join(home, '.deslop', name)),
		onSome: root => Effect.succeed(path.join(root, '.deslop', name))
	})
	yield* (yield* FileSystem.FileSystem).makeDirectory(directory, {mode: 0o700, recursive: true})
	return directory
})

// Every app's database once held its own sign-ins; Auth's cookie replaced them.
const retiredSessions = Layer.effectDiscard(
	Migrator.make({})({
		loader: Migrator.fromRecord({
			'0002_drop_sessions': Effect.flatMap(SqlClient.SqlClient, sql => sql`DROP TABLE IF EXISTS sessions`)
		}),
		table: 'sessions_migrations'
	})
)

// WAL commits need no sync of their own to survive a crash of the app; freed pages return to the disk and the planner's statistics stay current every hour. Incremental vacuum takes effect when the database is created, before any table, or after one VACUUM.
const tuned = Layer.effectDiscard(
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`PRAGMA auto_vacuum = INCREMENTAL`
		yield* sql`PRAGMA synchronous = NORMAL`
		yield* pipe(
			sql`PRAGMA incremental_vacuum`,
			Effect.andThen(sql`PRAGMA optimize`),
			Effect.withSpan('Store.maintain'),
			Effect.ignore({log: 'Warn', message: 'The database could not be compacted'}),
			Effect.schedule(Schedule.spaced(Duration.hours(1))),
			Effect.forkScoped
		)
	})
)

// The app's one SQLite database sits in `directory`, the data directory in production and a temporary one in tests; the database and the services share one Reactivity, so a committed write reaches every live query.
export function layerDataStore(directory: string) {
	return Layer.unwrap(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const filename = (yield* Path.Path).join(directory, 'data.sqlite')
			// SQLite creates its file but not the folder around it, and gives its -wal and -shm files the database's own mode: it holds keys and personal data, so only the user reads it.
			yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
			yield* fs.writeFile(filename, new Uint8Array(), {flag: 'a', mode: 0o600})
			// The settings run before the first migration creates a table.
			return Layer.provideMerge(
				retiredSessions,
				Layer.provideMerge(tuned, Layer.merge(SqliteClient.layer({filename}), Reactivity.layer))
			)
		})
	)
}
