import {Effect} from 'effect'

import {SqlClient} from 'effect/sql'

export const migrations = {
	'0001_ai': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`
			CREATE TABLE ai_keys (
				owner TEXT NOT NULL,
				provider TEXT NOT NULL,
				secret TEXT NOT NULL,
				last4 TEXT NOT NULL,
				lastStatus INTEGER,
				PRIMARY KEY (owner, provider)
			) STRICT, WITHOUT ROWID
		`
		// Keyed by person then hour, so a person's period reads as one range of the table.
		yield* sql`
			CREATE TABLE ai_usage (
				owner TEXT NOT NULL,
				hour INTEGER NOT NULL,
				provider TEXT NOT NULL,
				costUsd REAL NOT NULL,
				unknownCostCalls INTEGER NOT NULL,
				PRIMARY KEY (owner, hour, provider)
			) STRICT, WITHOUT ROWID
		`
	}),
	'0002_opencode_only': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`DELETE FROM ai_keys WHERE provider IN ('anthropic', 'openrouter')`
		yield* sql`DELETE FROM ai_usage WHERE provider IN ('anthropic', 'openrouter')`
	}),
	'0003_single_opencode': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`CREATE TABLE ai_keys_new (
			owner TEXT PRIMARY KEY NOT NULL,
			connectionUrl TEXT,
			secret TEXT NOT NULL,
			last4 TEXT NOT NULL,
			lastStatus INTEGER
		) STRICT, WITHOUT ROWID`
		yield* sql`INSERT INTO ai_keys_new (owner, secret, last4, lastStatus)
			SELECT owner, secret, last4, lastStatus FROM (
				SELECT *, row_number() OVER (PARTITION BY owner ORDER BY provider = 'opencode-zen' DESC) AS position
				FROM ai_keys
			) WHERE position = 1`
		yield* sql`DROP TABLE ai_keys`
		yield* sql`ALTER TABLE ai_keys_new RENAME TO ai_keys`
		yield* sql`CREATE TABLE ai_usage_new (
			owner TEXT NOT NULL, hour INTEGER NOT NULL, costUsd REAL NOT NULL, unknownCostCalls INTEGER NOT NULL,
			PRIMARY KEY (owner, hour)
		) STRICT, WITHOUT ROWID`
		yield* sql`INSERT INTO ai_usage_new SELECT owner, hour, sum(costUsd), sum(unknownCostCalls) FROM ai_usage GROUP BY owner, hour`
		yield* sql`DROP TABLE ai_usage`
		yield* sql`ALTER TABLE ai_usage_new RENAME TO ai_usage`
	}),
	'0004_spend_source': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`CREATE TABLE ai_usage_new (
			owner TEXT NOT NULL, hour INTEGER NOT NULL, spendSource TEXT NOT NULL,
			costUsd REAL NOT NULL, unknownCostCalls INTEGER NOT NULL, estimatedCalls INTEGER NOT NULL,
			PRIMARY KEY (owner, hour, spendSource)
		) STRICT, WITHOUT ROWID`
		// Earlier aggregates mixed balances and estimates; they cannot be attributed retrospectively.
		yield* sql`INSERT INTO ai_usage_new SELECT owner, hour, 'unattributed', costUsd, unknownCostCalls, 0 FROM ai_usage`
		yield* sql`DROP TABLE ai_usage`
		yield* sql`ALTER TABLE ai_usage_new RENAME TO ai_usage`
	}),
	'0005_payer_required': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`CREATE TABLE ai_usage_new (
			owner TEXT NOT NULL, hour INTEGER NOT NULL,
			spendSource TEXT NOT NULL CHECK (spendSource IN ('balance', 'byok', 'free', 'go', 'go-plus')),
			costUsd REAL NOT NULL, unknownCostCalls INTEGER NOT NULL, estimatedCalls INTEGER NOT NULL,
			PRIMARY KEY (owner, hour, spendSource)
		) STRICT, WITHOUT ROWID`
		// Spend recorded before it was split by payer is dropped, not guessed.
		yield* sql`INSERT INTO ai_usage_new SELECT * FROM ai_usage WHERE spendSource <> 'unattributed'`
		yield* sql`DROP TABLE ai_usage`
		yield* sql`ALTER TABLE ai_usage_new RENAME TO ai_usage`
	}),
	'0006_anthropic_key': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`CREATE TABLE ai_keys_new (
			owner TEXT NOT NULL, provider TEXT NOT NULL CHECK (provider IN ('opencode', 'anthropic')),
			secret TEXT NOT NULL, last4 TEXT NOT NULL, lastStatus INTEGER,
			PRIMARY KEY (owner, provider)
		) STRICT, WITHOUT ROWID`
		yield* sql`INSERT INTO ai_keys_new SELECT owner, 'opencode', secret, last4, lastStatus FROM ai_keys`
		yield* sql`DROP TABLE ai_keys`
		yield* sql`ALTER TABLE ai_keys_new RENAME TO ai_keys`
	}),
	'0007_openai_key': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`CREATE TABLE ai_keys_new (
			owner TEXT NOT NULL, provider TEXT NOT NULL CHECK (provider IN ('opencode', 'anthropic', 'openai')),
			secret TEXT NOT NULL, last4 TEXT NOT NULL, lastStatus INTEGER,
			PRIMARY KEY (owner, provider)
		) STRICT, WITHOUT ROWID`
		yield* sql`INSERT INTO ai_keys_new SELECT * FROM ai_keys`
		yield* sql`DROP TABLE ai_keys`
		yield* sql`ALTER TABLE ai_keys_new RENAME TO ai_keys`
		yield* sql`CREATE TABLE ai_usage_new (
			owner TEXT NOT NULL, hour INTEGER NOT NULL,
			spendSource TEXT NOT NULL CHECK (spendSource IN ('balance', 'byok', 'openai', 'free', 'go', 'go-plus')),
			costUsd REAL NOT NULL, unknownCostCalls INTEGER NOT NULL, estimatedCalls INTEGER NOT NULL,
			PRIMARY KEY (owner, hour, spendSource)
		) STRICT, WITHOUT ROWID`
		yield* sql`INSERT INTO ai_usage_new SELECT * FROM ai_usage`
		yield* sql`DROP TABLE ai_usage`
		yield* sql`ALTER TABLE ai_usage_new RENAME TO ai_usage`
	}),
	// Each historical hour becomes one call carrying its full cost and any uncertainty.
	'0008_ai_calls': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`CREATE TABLE ai_calls (
			owner TEXT NOT NULL, at INTEGER NOT NULL,
			spendSource TEXT NOT NULL CHECK (spendSource IN ('balance', 'byok', 'openai', 'free', 'go', 'go-plus')),
			costUsd REAL NOT NULL,
			estimated INTEGER NOT NULL CHECK (estimated IN (0, 1)),
			costKnown INTEGER NOT NULL CHECK (costKnown IN (0, 1))
		) STRICT`
		yield* sql`INSERT INTO ai_calls (owner, at, spendSource, costUsd, estimated, costKnown)
			SELECT owner, hour, spendSource, costUsd, estimatedCalls > 0, unknownCostCalls = 0 FROM ai_usage`
		yield* sql`DROP TABLE ai_usage`
		yield* sql`CREATE INDEX ai_calls_owner_at ON ai_calls (owner, at)`
	})
}
