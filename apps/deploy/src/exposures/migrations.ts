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
	),
	// An exposure is desired state: a removal is saved as `removing` before any external change, and today's rows stay published.
	'0002_exposure_state': Effect.flatMap(
		SqlClient.SqlClient,
		sql => sql`ALTER TABLE exposures ADD COLUMN state TEXT NOT NULL DEFAULT 'active'`
	),
	// What listened on the port when it was published, as the worker's inventory named it; empty only for a row saved before Deploy recorded owners.
	'0003_exposure_owner': Effect.flatMap(SqlClient.SqlClient, sql => sql`ALTER TABLE exposures ADD COLUMN owner TEXT`)
}
