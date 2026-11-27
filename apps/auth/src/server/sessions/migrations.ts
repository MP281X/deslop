import {Effect, Layer} from 'effect'

import {Migrator, SqlClient} from 'effect/sql'

export const sessionsMigrations = Layer.effectDiscard(
	Migrator.make({})({
		loader: Migrator.fromRecord({
			'0001_cookie_sessions': Effect.flatMap(
				SqlClient.SqlClient,
				sql =>
					sql`CREATE TABLE cookie_sessions (id TEXT PRIMARY KEY, userId TEXT NOT NULL, address TEXT, browser TEXT NOT NULL, createdAt INTEGER NOT NULL, lastSeenAt INTEGER NOT NULL) STRICT`
			),
			// A person's sessions are listed newest first and removed together without scanning everyone's.
			'0002_user_sessions': Effect.flatMap(
				SqlClient.SqlClient,
				sql => sql`CREATE INDEX cookie_sessions_user ON cookie_sessions (userId, lastSeenAt)`
			)
		}),
		table: 'cookie_sessions_migrations'
	})
)
