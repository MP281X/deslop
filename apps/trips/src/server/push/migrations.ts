import {DateTime, Duration, Effect, Option, Schema} from 'effect'

import {SqlClient} from 'effect/sql'

import {ActivityProps} from '#contracts'

import {ActivityPropsJson} from './schema.ts'

// One statement per SQL call, since SQLite runs only the first statement of a string.
export const migrations = {
	'0001_push': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`
			CREATE TABLE devices (
				bundle TEXT NOT NULL,
				kind TEXT NOT NULL,
				token TEXT NOT NULL,
				PRIMARY KEY (bundle, kind)
			) STRICT, WITHOUT ROWID
		`
		// A channel is one activity's: every update and its end go through it.
		yield* sql`
			CREATE TABLE activities (
				channel TEXT PRIMARY KEY,
				bookingId TEXT NOT NULL,
				leg TEXT NOT NULL,
				bundle TEXT NOT NULL,
				startedAt INTEGER NOT NULL,
				endedAt INTEGER,
				props TEXT NOT NULL,
				UNIQUE (bookingId, leg, bundle)
			) STRICT
		`
		yield* sql`
			CREATE TABLE sent_alerts (
				bookingId TEXT NOT NULL,
				key TEXT NOT NULL,
				sentAt INTEGER NOT NULL,
				PRIMARY KEY (bookingId, key)
			) STRICT, WITHOUT ROWID
		`
	}),
	'0002_alert_records': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`ALTER TABLE sent_alerts RENAME TO packed_alerts`
		yield* sql`CREATE TABLE sent_alerts (bookingId TEXT NOT NULL, category TEXT NOT NULL, value TEXT, sentAt INTEGER NOT NULL) STRICT`
		yield* sql`INSERT INTO sent_alerts (bookingId, category, value, sentAt) SELECT bookingId, CASE WHEN instr(key, ':') = 0 THEN key ELSE substr(key, 1, instr(key, ':') - 1) END, CASE WHEN instr(key, ':') = 0 THEN NULL ELSE substr(key, instr(key, ':') + 1) END, sentAt FROM packed_alerts`
		yield* sql`DROP TABLE packed_alerts`
		yield* sql`CREATE UNIQUE INDEX alert_value ON sent_alerts (bookingId, category, value) WHERE value IS NOT NULL`
		yield* sql`CREATE UNIQUE INDEX alert_once ON sent_alerts (bookingId, category) WHERE value IS NULL`
	}),
	'0003_requests': Effect.gen(function* () {
		yield* (yield* SqlClient.SqlClient)`CREATE TABLE requests (bookingId TEXT PRIMARY KEY, at INTEGER NOT NULL) STRICT, WITHOUT ROWID`
	}),
	'0004_device_delivery': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`ALTER TABLE devices RENAME TO old_devices`
		yield* sql`CREATE TABLE devices (token TEXT PRIMARY KEY, bundle TEXT NOT NULL, kind TEXT NOT NULL) STRICT, WITHOUT ROWID`
		yield* sql`INSERT INTO devices SELECT token, bundle, kind FROM old_devices`
		yield* sql`DROP TABLE old_devices`
		yield* sql`CREATE TABLE deliveries (bookingId TEXT NOT NULL, category TEXT NOT NULL, value TEXT, sentAt INTEGER NOT NULL, token TEXT NOT NULL) STRICT`
		yield* sql`CREATE UNIQUE INDEX delivery_value ON deliveries (bookingId, category, value, token) WHERE value IS NOT NULL`
		yield* sql`CREATE UNIQUE INDEX delivery_once ON deliveries (bookingId, category, token) WHERE value IS NULL`
	}),
	// A round reads one booking's receipts in the order they were sent; neither partial unique index covers that read.
	'0005_receipt_order': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`CREATE INDEX delivery_order ON deliveries (bookingId, sentAt)`
		yield* sql`CREATE INDEX alert_order ON sent_alerts (bookingId, sentAt)`
	}),
	// Channels still to end or delete; every activity ended before it had its channel deleted already.
	'0006_retirements': Effect.gen(function* () {
		yield* (yield* SqlClient.SqlClient)`
			CREATE TABLE retirements (
				channel TEXT PRIMARY KEY,
				bundle TEXT NOT NULL,
				props TEXT,
				retiredAt INTEGER NOT NULL
			) STRICT, WITHOUT ROWID
		`
	}),
	// Trains left, and their props no longer decode: a train's activity becomes a channel that is only deleted, and a train's retirement still deletes its channel without sending the end.
	'0007_no_trains': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const now = DateTime.toEpochMillis(yield* DateTime.now)
		yield* sql`UPDATE retirements SET props = NULL WHERE json_extract(props, '$.kind') = 'train'`
		yield* sql`
			INSERT INTO retirements (channel, bundle, props, retiredAt)
			SELECT channel, bundle, NULL, ${now} FROM activities WHERE json_extract(props, '$.kind') = 'train'
			ON CONFLICT (channel) DO NOTHING
		`
		yield* sql`DELETE FROM activities WHERE json_extract(props, '$.kind') = 'train'`
	}),
	// Baggage belts left, and a belt's alert records name a category that no longer decodes.
	'0008_no_belts': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`DELETE FROM sent_alerts WHERE category = 'belt'`
		yield* sql`DELETE FROM deliveries WHERE category = 'belt'`
	}),
	// Trips holds only flights, so each table names the flight its rows belong to.
	'0009_flight_ids': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`ALTER TABLE activities RENAME COLUMN bookingId TO flightId`
		yield* sql`ALTER TABLE sent_alerts RENAME COLUMN bookingId TO flightId`
		yield* sql`ALTER TABLE deliveries RENAME COLUMN bookingId TO flightId`
		// Live Activities start only by themselves, so nothing reads when one was asked for.
		yield* sql`DROP TABLE requests`
	}),
	// A token names the iPhone it belongs to, and an activity the iPhone it runs on. Older tokens never said, so they go, and each app registers both again at its next launch; a running activity is retired, and the next round starts it afresh on a named phone.
	'0010_phones': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const now = DateTime.toEpochMillis(yield* DateTime.now)
		yield* sql`DROP TABLE devices`
		yield* sql`CREATE TABLE devices (token TEXT PRIMARY KEY, bundle TEXT NOT NULL, kind TEXT NOT NULL, phone TEXT NOT NULL) STRICT, WITHOUT ROWID`
		yield* sql`
			INSERT INTO retirements (channel, bundle, props, retiredAt)
			SELECT channel, bundle, props, ${now} FROM activities WHERE endedAt IS NULL
			ON CONFLICT (channel) DO NOTHING
		`
		yield* sql`DROP TABLE activities`
		yield* sql`
			CREATE TABLE activities (
				channel TEXT PRIMARY KEY,
				flightId TEXT NOT NULL,
				leg TEXT NOT NULL,
				bundle TEXT NOT NULL,
				phone TEXT NOT NULL,
				startedAt INTEGER NOT NULL,
				endedAt INTEGER,
				props TEXT NOT NULL,
				UNIQUE (flightId, leg, bundle)
			) STRICT
		`
	}),
	// One activity follows the whole day, and the props of a flight's activity no longer decode: each running one, and each whose end is still owed, ends on the phone with a last frame in the new shape, and the day's activity starts afresh.
	'0011_day_activities': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const now = yield* DateTime.now
		const ended = yield* Schema.encodeEffect(ActivityPropsJson)(
			ActivityProps.make({
				deadline: Option.none(),
				delay: Duration.zero,
				gate: Option.none(),
				label: 'Live Activity',
				note: '',
				noteTone: 'plain',
				noteWas: Option.none(),
				pending: false,
				phase: 'landed',
				problem: Option.none(),
				segment: 3,
				segmentSince: now,
				segmentUntil: now,
				since: now,
				small: '',
				symbol: 'airplane',
				tone: 'plain',
				until: '',
				untilValue: '',
				value: 'Ended',
				was: Option.none()
			})
		)
		yield* sql`UPDATE retirements SET props = ${ended} WHERE props IS NOT NULL`
		yield* sql`
			INSERT INTO retirements (channel, bundle, props, retiredAt)
			SELECT channel, bundle, ${ended}, ${DateTime.toEpochMillis(now)} FROM activities WHERE endedAt IS NULL
			ON CONFLICT (channel) DO NOTHING
		`
		yield* sql`DELETE FROM activities`
	})
}
