import {Effect} from 'effect'

import {SqlClient} from 'effect/sql'

export const migrations = {
	'0001_bookings': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`
			CREATE TABLE flights (
				id TEXT PRIMARY KEY,
				status TEXT NOT NULL,
				airline TEXT NOT NULL,
				airlineCode TEXT NOT NULL,
				number TEXT NOT NULL,
				"from" TEXT NOT NULL,
				"to" TEXT NOT NULL,
				departs INTEGER NOT NULL,
				arrives INTEGER NOT NULL,
				boardingAt INTEGER,
				boardingGroup TEXT,
				confirmation TEXT,
				seat TEXT,
				live TEXT
			) STRICT
		`
		yield* sql`
			CREATE TABLE trains (
				id TEXT PRIMARY KEY,
				status TEXT NOT NULL,
				operator TEXT NOT NULL,
				operatorName TEXT NOT NULL,
				number TEXT NOT NULL,
				"from" TEXT NOT NULL,
				"to" TEXT NOT NULL,
				departs INTEGER NOT NULL,
				arrives INTEGER NOT NULL,
				coach TEXT,
				confirmation TEXT,
				seat TEXT,
				live TEXT
			) STRICT
		`
		yield* sql`
			CREATE TABLE stays (
				id TEXT PRIMARY KEY,
				status TEXT NOT NULL,
				name TEXT NOT NULL,
				place TEXT NOT NULL,
				checkIn INTEGER NOT NULL,
				checkOut INTEGER NOT NULL,
				confirmation TEXT
			) STRICT
		`
	}),
	'0002_timetable': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`ALTER TABLE trains DROP COLUMN operatorName`
		yield* sql`ALTER TABLE trains ADD COLUMN service TEXT NOT NULL DEFAULT ''`
		yield* sql`ALTER TABLE trains ADD COLUMN stops TEXT NOT NULL DEFAULT '[]'`
		yield* sql`UPDATE trains SET service = number`
	}),
	'0003_no_trains': Effect.gen(function* () {
		yield* (yield* SqlClient.SqlClient)`DROP TABLE trains`
	}),
	'0004_no_stays': Effect.gen(function* () {
		yield* (yield* SqlClient.SqlClient)`DROP TABLE stays`
	})
}
