import {Effect} from 'effect'

import {SqlClient} from 'effect/sql'

export const migrations = {
	'0001_connections': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`
			CREATE TABLE connections (
				id TEXT PRIMARY KEY,
				url TEXT NOT NULL UNIQUE,
				generation TEXT NOT NULL,
				mode TEXT NOT NULL,
				name TEXT NOT NULL,
				tools INTEGER NOT NULL,
				icons TEXT NOT NULL,
				instructions TEXT,
				error TEXT,
				issuer TEXT,
				scope TEXT
			) STRICT
		`
		yield* sql`
			CREATE TABLE connection_grants (
				serverId TEXT PRIMARY KEY REFERENCES connections (id) ON DELETE CASCADE,
				accessToken TEXT NOT NULL,
				refreshToken TEXT,
				expiresAt REAL NOT NULL,
				clientId TEXT NOT NULL,
				tokenEndpoint TEXT NOT NULL
			) STRICT
		`
		// Keyed by server first, so a server's period reads as one range of the table.
		yield* sql`
			CREATE TABLE connection_calls (
				serverId TEXT NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
				hour INTEGER NOT NULL,
				calls INTEGER NOT NULL,
				PRIMARY KEY (serverId, hour)
			) STRICT, WITHOUT ROWID
		`
	}),
	// Expand each historical count into calls dated to that hour.
	'0002_mcp_calls': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`CREATE TABLE mcp_calls (
			serverId TEXT NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
			at INTEGER NOT NULL
		) STRICT`
		yield* sql`WITH RECURSIVE calls (serverId, at, remaining) AS (
			SELECT serverId, hour, calls FROM connection_calls WHERE calls > 0
			UNION ALL
			SELECT serverId, at, remaining - 1 FROM calls WHERE remaining > 1
		)
		INSERT INTO mcp_calls (serverId, at) SELECT serverId, at FROM calls`
		yield* sql`DROP TABLE connection_calls`
		yield* sql`CREATE INDEX mcp_calls_server_at ON mcp_calls (serverId, at)`
	}),
	'0003_failure_reasons': Effect.gen(function* () {
		yield* (yield* SqlClient.SqlClient)`UPDATE connections SET error = NULL`
	})
}
