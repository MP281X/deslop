import {Effect} from 'effect'

import {SqlClient} from 'effect/sql'

export const migrations = {
	'0001_exposures': Effect.flatMap(
		SqlClient.SqlClient,
		sql => sql`
			CREATE TABLE exposures (
				name TEXT PRIMARY KEY,
				kind TEXT NOT NULL,
				hostname TEXT NOT NULL,
				port INTEGER NOT NULL
			) STRICT
		`
	)
}
