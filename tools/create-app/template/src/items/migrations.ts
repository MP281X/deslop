import {Effect} from 'effect'

import {SqlClient} from 'effect/sql'

export const migrations = {
	'0001_items': Effect.flatMap(
		SqlClient.SqlClient,
		sql => sql`
			CREATE TABLE items (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				line TEXT NOT NULL,
				body TEXT NOT NULL
			) STRICT
		`
	),
	'0002_example_items': Effect.flatMap(
		SqlClient.SqlClient,
		sql => sql`
			INSERT INTO items (id, title, line, body) VALUES
				('first', 'First item', 'Example entry', 'This item is served by template-app.'),
				('second', 'Second item', 'Example entry', 'This item has its own link.')
		`
	)
}
