import {Array, DateTime, Effect, Option, Schema, pipe} from 'effect'

import {SqlClient, SqlSchema} from 'effect/sql'

import {serviceOf} from '#services/flights/lib/utils.ts'
import {LegacyFlight} from '#services/flights/schema.ts'

// The push tables that name a flight; `requests` is dropped by push's own migrations, so nothing in it moves.
const PUSH_TABLES = ['activities', 'sent_alerts', 'deliveries']

// Rows of one service, keyed as a ticket finds its flight, join the first saved.
function joinedOf(rows: readonly LegacyFlight[]) {
	const start: {joined: readonly {id: string; into: string}[]; kept: readonly LegacyFlight[]} = {joined: [], kept: []}
	return Array.reduce(rows, start, (state, row) =>
		pipe(
			state.kept,
			Array.findFirst(kept => serviceOf(kept) === serviceOf(row)),
			Option.match({
				onNone: () => ({...state, kept: [...state.kept, row]}),
				onSome: into => ({...state, joined: [...state.joined, {id: row.id, into: into.id}]})
			})
		)
	).joined
}

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
	}),
	// A flight is one service with everyone on it: each row becomes one traveller holding its seat, group, code and status, a field it lacks left out as the JSON leaves out an absent one; rows of the same service join the first saved, and the push records of a joined row follow it.
	'0005_travellers': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`ALTER TABLE flights ADD COLUMN travellers TEXT NOT NULL DEFAULT '[]'`
		yield* sql`
			UPDATE flights
			SET travellers = json_array(
				json_patch(
					'{}',
					json_object('boardingGroup', boardingGroup, 'confirmation', confirmation, 'seat', seat, 'status', status)
				)
			)
		`
		const rows = yield* SqlSchema.findAll({
			Request: Schema.Void,
			Result: LegacyFlight,
			execute: () =>
				sql`
					SELECT id, airlineCode, number, departs,
						coalesce(json_extract("from", '$.code'), json_extract("from", '$.name')) AS origin,
						json_extract("from", '$.timeZone') AS timeZone
					FROM flights ORDER BY rowid
				`
		})()
		// Push keeps its own tables, made after this on a new database; on an old one they still name the row `bookingId`.
		const pushed = Array.isReadonlyArrayNonEmpty(
			yield* sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'activities'`
		)
		if (pushed) {
			// A running activity opens a booking link the app no longer reads, and its link cannot change, so it ends: its channel is retired and the next round starts the flight's leg afresh.
			yield* sql`
				INSERT INTO retirements (channel, bundle, props, retiredAt)
				SELECT channel, bundle, props, ${DateTime.toEpochMillis(yield* DateTime.now)} FROM activities WHERE endedAt IS NULL
				ON CONFLICT (channel) DO NOTHING
			`
			yield* sql`DELETE FROM activities WHERE endedAt IS NULL`
		}
		yield* Effect.forEach(
			joinedOf(rows),
			pair =>
				Effect.gen(function* () {
					yield* sql`
						UPDATE flights SET
							travellers = (
								SELECT json_group_array(json(value)) FROM (
									SELECT item.value FROM flights AS joined, json_each(joined.travellers) AS item
									WHERE joined.id IN (${pair.into}, ${pair.id}) ORDER BY joined.id = ${pair.id}, item.key
								)
							),
							boardingAt = coalesce(boardingAt, (SELECT boardingAt FROM flights WHERE id = ${pair.id}))
						WHERE id = ${pair.into}
					`
					yield* sql`DELETE FROM flights WHERE id = ${pair.id}`
					if (!pushed) return
					// A record both rows hold keeps the later time either was sent, so an alert the joined row received last still reads as the latest and is not sent again.
					yield* sql`
						UPDATE sent_alerts SET sentAt = max(sentAt, coalesce((
							SELECT max(joined.sentAt) FROM sent_alerts AS joined
							WHERE joined.bookingId = ${pair.id} AND joined.category = sent_alerts.category AND joined.value IS sent_alerts.value
						), sentAt))
						WHERE bookingId = ${pair.into}
					`
					yield* sql`
						UPDATE deliveries SET sentAt = max(sentAt, coalesce((
							SELECT max(joined.sentAt) FROM deliveries AS joined
							WHERE joined.bookingId = ${pair.id} AND joined.category = deliveries.category AND joined.value IS deliveries.value
								AND joined.token = deliveries.token
						), sentAt))
						WHERE bookingId = ${pair.into}
					`
					// Every other record moves to the flight it joined unless that flight holds its like already, as an ended activity for the same leg and app.
					yield* Effect.forEach(
						PUSH_TABLES,
						table => sql`UPDATE OR IGNORE ${sql(table)} SET bookingId = ${pair.into} WHERE bookingId = ${pair.id}`,
						{concurrency: 1, discard: true}
					)
					yield* Effect.forEach(PUSH_TABLES, table => sql`DELETE FROM ${sql(table)} WHERE bookingId = ${pair.id}`, {
						concurrency: 1,
						discard: true
					})
				}),
			{concurrency: 1, discard: true}
		)
		yield* sql`ALTER TABLE flights DROP COLUMN seat`
		yield* sql`ALTER TABLE flights DROP COLUMN boardingGroup`
		yield* sql`ALTER TABLE flights DROP COLUMN confirmation`
		yield* sql`ALTER TABLE flights DROP COLUMN status`
	}),
	// The trip from home to each airport, saved once for the airport, which sets when to leave.
	'0006_travel_times': Effect.gen(function* () {
		yield* (yield* SqlClient.SqlClient)`CREATE TABLE travel_times (airport TEXT PRIMARY KEY, minutes INTEGER NOT NULL) STRICT, WITHOUT ROWID`
	})
}
