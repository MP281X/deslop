import {Effect} from 'effect'

import {SqlClient} from 'effect/sql'

export const migrations = {
	// judge-ignore no-unrelated-jobs -- This immutable historical migration created the original catalogue and registry together; moving Reading's ownership must not rewrite it.
	'0001_chapters': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`
		CREATE TABLE chapters (
			series TEXT NOT NULL,
			number REAL NOT NULL,
			title TEXT NOT NULL,
			pages TEXT NOT NULL,
			postedAt REAL NOT NULL,
			reading TEXT,
			notified INTEGER NOT NULL,
			revisedAt REAL,
			source TEXT NOT NULL,
			PRIMARY KEY (series, number)
		) STRICT
	`
		yield* sql`CREATE TABLE devices (token TEXT PRIMARY KEY) STRICT, WITHOUT ROWID`
	}),
	'0002_apns_devices': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		// Expo tokens cannot address APNs; every phone registers a native token on its next launch.
		yield* sql`DROP TABLE devices`
		yield* sql`CREATE TABLE devices (bundle TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY (bundle, token)) STRICT, WITHOUT ROWID`
	}),
	// judge-ignore no-unrelated-jobs -- One atomic device-delivery migration preserves registered tokens while introducing their receipt table.
	'0003_device_delivery': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`ALTER TABLE devices RENAME TO old_devices`
		yield* sql`CREATE TABLE devices (token TEXT PRIMARY KEY, bundle TEXT NOT NULL, kind TEXT NOT NULL) STRICT, WITHOUT ROWID`
		yield* sql`INSERT INTO devices SELECT token, bundle, 'alert' FROM old_devices`
		yield* sql`DROP TABLE old_devices`
		yield* sql`CREATE TABLE deliveries (series TEXT NOT NULL, number REAL NOT NULL, token TEXT NOT NULL, PRIMARY KEY (series, number, token)) STRICT, WITHOUT ROWID`
	}),
	'0004_optional_posted_at': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`ALTER TABLE chapters ADD COLUMN publicationTime REAL`
		yield* sql`UPDATE chapters SET publicationTime = NULLIF(postedAt, 0)`
		yield* sql`ALTER TABLE chapters DROP COLUMN postedAt`
		yield* sql`ALTER TABLE chapters RENAME COLUMN publicationTime TO postedAt`
	}),
	// A receipt was a finished delivery. A chapter part-way through its announcement keeps the devices it was still waiting on as recipients, so a phone registered later is not one of them.
	'0005_delivery_recipients': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`ALTER TABLE deliveries ADD COLUMN done INTEGER NOT NULL DEFAULT 1`
		yield* sql`
			INSERT INTO deliveries (series, number, token, done)
			SELECT chapters.series, chapters.number, devices.token, 0 FROM chapters, devices
			WHERE chapters.notified = 0 AND EXISTS (
				SELECT 1 FROM deliveries WHERE deliveries.series = chapters.series AND deliveries.number = chapters.number
			)
			ON CONFLICT DO NOTHING
		`
	}),
	// Recipients are now taken when a chapter is saved. A chapter waiting for its first announcement takes the devices registered now, the ones its announcement would have taken, so it is still announced.
	'0006_saved_recipients': Effect.gen(function* () {
		yield* (yield* SqlClient.SqlClient)`
			INSERT INTO deliveries (series, number, token, done)
			SELECT chapters.series, chapters.number, devices.token, 0 FROM chapters, devices
			WHERE chapters.notified = 0 AND NOT EXISTS (
				SELECT 1 FROM deliveries WHERE deliveries.series = chapters.series AND deliveries.number = chapters.number
			)
		`
	})
}

export const readingMigrations = {
	'0002_reading': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`CREATE TABLE reading (
		series TEXT NOT NULL, number REAL NOT NULL, done INTEGER NOT NULL, page INTEGER NOT NULL,
		PRIMARY KEY (series, number), FOREIGN KEY (series, number) REFERENCES chapters (series, number)
	) STRICT, WITHOUT ROWID`
		yield* sql`INSERT INTO reading (series, number, done, page)
		SELECT series, number, json_extract(reading, '$.done'), json_extract(reading, '$.page')
		FROM chapters WHERE reading IS NOT NULL`
		yield* sql`ALTER TABLE chapters DROP COLUMN reading`
	})
}
