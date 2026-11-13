import {Effect, Layer} from 'effect'

import {Migrator, SqlClient} from 'effect/sql'

// Keep the numbered history so an installed database drops the removed catalog as well.
export const appCatalogMigrations = Layer.effectDiscard(
	Migrator.make({})({
		loader: Migrator.fromRecord({
			'0001_apps': Effect.flatMap(
				SqlClient.SqlClient,
				sql => sql`CREATE TABLE apps (origin TEXT PRIMARY KEY, name TEXT NOT NULL) STRICT`
			),
			'0002_remove_catalog': Effect.flatMap(SqlClient.SqlClient, sql => sql`DROP TABLE apps`)
		}),
		table: 'apps_migrations'
	})
)
