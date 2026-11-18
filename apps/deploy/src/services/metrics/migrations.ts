import {Effect} from 'effect'

import {SqlClient} from 'effect/sql'

export const migrations = {
	// Keyed by series, then time, so a range reads one span of the key; its rows carry the apps' JSON, too wide for WITHOUT ROWID.
	'0001_metrics': Effect.flatMap(
		SqlClient.SqlClient,
		sql => sql`
			CREATE TABLE samples (
				step INTEGER NOT NULL,
				since INTEGER NOT NULL,
				time INTEGER NOT NULL,
				cpu REAL,
				memoryTotal REAL NOT NULL,
				memoryUsed REAL NOT NULL,
				storageUsed REAL,
				apps TEXT,
				PRIMARY KEY (step, since)
			) STRICT
		`
	),
	'0002_app_samples': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`
			CREATE TABLE app_samples (
				step INTEGER NOT NULL,
				since INTEGER NOT NULL,
				app TEXT NOT NULL,
				cpu REAL,
				memory REAL NOT NULL,
				PRIMARY KEY (step, since, app)
			) STRICT, WITHOUT ROWID
		`
		yield* sql`
			INSERT INTO app_samples (step, since, app, cpu, memory)
			SELECT samples.step, samples.since,
				json_extract(app.value, '$.id'), json_extract(app.value, '$.cpu'), json_extract(app.value, '$.memory')
			FROM samples, json_each(samples.apps) app
		`
		yield* sql`ALTER TABLE samples DROP COLUMN apps`
		yield* sql`DELETE FROM app_samples WHERE step = 1000`
		yield* sql`DELETE FROM samples WHERE step = 1000`
	})
}
