import {Effect} from 'effect'

import {SqlClient} from 'effect/sql'

// The tables GitHubActions owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
export const migrations = {
	// A job whose log the webhook asked for: pending until it is stored or given up on, then kept a month so a redelivery asks nothing again.
	'0001_ci_log_fetches': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`
				CREATE TABLE ci_log_fetches (
					job INTEGER PRIMARY KEY NOT NULL,
					event TEXT NOT NULL,
					attempts INTEGER NOT NULL,
					dueAt INTEGER NOT NULL,
					requestedAt INTEGER NOT NULL,
					finishedAt INTEGER
				) STRICT
			`
		yield* sql`CREATE INDEX ci_log_fetches_by_due ON ci_log_fetches (dueAt, job) WHERE finishedAt IS NULL`
		yield* sql`CREATE INDEX ci_log_fetches_by_finished ON ci_log_fetches (finishedAt) WHERE finishedAt IS NOT NULL`
	})
}
