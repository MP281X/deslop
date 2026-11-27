import {Effect, Layer} from 'effect'

import {Migrator, SqlClient} from 'effect/sql'

export const peopleMigrations = Layer.effectDiscard(
	Migrator.make({})({
		loader: Migrator.fromRecord({
			'0001_members': Effect.flatMap(
				SqlClient.SqlClient,
				sql =>
					sql`CREATE TABLE members (id TEXT PRIMARY KEY, name TEXT NOT NULL, fullName TEXT, incarnation TEXT NOT NULL, since INTEGER NOT NULL, status TEXT NOT NULL) STRICT`
			),
			'0002_identity': Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				for (const table of [
					'browser_sessions',
					'app_grants',
					'spent_refresh_tokens',
					'signing_keys',
					'passkeys',
					'apps',
					'tokens_migrations',
					'passkeys_migrations',
					'apps_migrations'
				]) {
					yield* sql`DROP TABLE IF EXISTS ${sql(table)}`
				}
				yield* sql`ALTER TABLE members DROP COLUMN incarnation`
			}),
			'0003_nullable_since': Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				yield* sql`CREATE TABLE members_next (id TEXT PRIMARY KEY, name TEXT NOT NULL, fullName TEXT, since INTEGER, status TEXT NOT NULL) STRICT`
				yield* sql`INSERT INTO members_next SELECT id, name, fullName, NULLIF(since, 0), status FROM members`
				yield* sql`DROP TABLE members`
				yield* sql`ALTER TABLE members_next RENAME TO members`
			}),
			// A tailnet sighting stops approving the browser: the browser's status may be none and the sighting is its own column. Every row keeps its status, so whoever enters from a browser still does; no waiting row was seen on the tailnet, which made it Allowed, and an allowed one is marked at its next sighting.
			'0004_tailnet': Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient
				yield* sql`CREATE TABLE members_next (id TEXT PRIMARY KEY, name TEXT NOT NULL, fullName TEXT, since INTEGER, status TEXT, tailnet INTEGER NOT NULL) STRICT`
				yield* sql`INSERT INTO members_next SELECT id, name, fullName, since, status, 0 FROM members ORDER BY rowid`
				yield* sql`DROP TABLE members`
				yield* sql`ALTER TABLE members_next RENAME TO members`
			}),
			// A tailnet user stays the GitHub account it was first resolved to; everyone already here is bound at their next sighting.
			'0005_bindings': Effect.flatMap(
				SqlClient.SqlClient,
				sql => sql`CREATE TABLE tailnet_bindings (tailnetId TEXT PRIMARY KEY, userId TEXT NOT NULL) STRICT`
			)
		}),
		table: 'members_migrations'
	})
)
