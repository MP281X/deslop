import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, Layer, Record, String} from 'effect'

import {Migrator, SqlClient} from 'effect/sql'

import {layerDataStore} from '@deslop/runtime/server/store'

import {migrations} from './migrations.ts'

const KEPT = '11111111-0d0a-4a5e-9d8f-5b2a1c3d4e5f'
const JOINED = '22222222-0d0a-4a5e-9d8f-5b2a1c3d4e5f'
const OTHER = '33333333-0d0a-4a5e-9d8f-5b2a1c3d4e5f'
const NEXT_DAY = '44444444-0d0a-4a5e-9d8f-5b2a1c3d4e5f'
const BUNDLE = 'xyz.mp281x.trips'
const DEPARTS = Date.parse('2026-11-23T15:30:00Z')

const store = Layer.provide(
	Layer.unwrap(
		Effect.gen(function* () {
			return layerDataStore(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped())
		})
	),
	NodeServices.layer
)

function migrate(upTo: string) {
	return Migrator.make({})({
		loader: Migrator.fromRecord(Record.filter(migrations, (_, key) => String.localeCompare(upTo)(key) < 0)),
		table: 'bookings_migrations'
	})
}

function place(code: string) {
	return `{"code":"${code}","name":"${code}","timeZone":"UTC"}`
}

// The flights and push tables as they stand before travellers: a row per ticket, and push records that name each row as their booking.
const tickets = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	yield* migrate('0005')
	yield* sql`
		INSERT INTO flights (id, status, airline, airlineCode, number, "from", "to", departs, arrives, boardingAt, confirmation, seat)
		VALUES
			(${KEPT}, 'confirmed', 'British Airways', 'BA', '1234', ${place('BGY')}, ${place('STN')}, ${DEPARTS}, ${DEPARTS + 7_200_000}, NULL, 'ONE', '11A'),
			(${JOINED}, 'confirmed', 'British Airways', 'BA', '1234', ${place('BGY')}, ${place('STN')}, ${DEPARTS + 600_000}, ${DEPARTS + 7_200_000}, ${DEPARTS - 1_800_000}, 'TWO', '11B'),
			(${OTHER}, 'cancelled', 'British Airways', 'BA', '553', ${place('FCO')}, ${place('LHR')}, ${DEPARTS}, ${DEPARTS + 9_000_000}, NULL, NULL, NULL),
			(${NEXT_DAY}, 'confirmed', 'British Airways', 'BA', '1234', ${place('BGY')}, ${place('STN')}, ${DEPARTS + 68_400_000}, ${DEPARTS + 75_600_000}, NULL, 'ONE', '11A')
	`
	yield* sql`CREATE TABLE activities (channel TEXT PRIMARY KEY, bookingId TEXT NOT NULL, leg TEXT NOT NULL, bundle TEXT NOT NULL, startedAt INTEGER NOT NULL, endedAt INTEGER, props TEXT NOT NULL, UNIQUE (bookingId, leg, bundle)) STRICT`
	yield* sql`CREATE TABLE sent_alerts (bookingId TEXT NOT NULL, category TEXT NOT NULL, value TEXT, sentAt INTEGER NOT NULL) STRICT`
	yield* sql`CREATE UNIQUE INDEX alert_value ON sent_alerts (bookingId, category, value) WHERE value IS NOT NULL`
	yield* sql`CREATE TABLE deliveries (bookingId TEXT NOT NULL, category TEXT NOT NULL, value TEXT, sentAt INTEGER NOT NULL, token TEXT NOT NULL) STRICT`
	yield* sql`CREATE TABLE requests (bookingId TEXT PRIMARY KEY, at INTEGER NOT NULL) STRICT, WITHOUT ROWID`
	yield* sql`CREATE TABLE retirements (channel TEXT PRIMARY KEY, bundle TEXT NOT NULL, props TEXT, retiredAt INTEGER NOT NULL) STRICT, WITHOUT ROWID`
	yield* sql`
		INSERT INTO activities (channel, bookingId, leg, bundle, startedAt, props) VALUES
			('kept', ${KEPT}, 'departure', ${BUNDLE}, 1, '{}'),
			('clash', ${JOINED}, 'departure', ${BUNDLE}, 1, '{}'),
			('moved', ${JOINED}, 'departure', 'xyz.mp281x.trips.dev', 1, '{}')
	`
	yield* sql`
		INSERT INTO sent_alerts (bookingId, category, value, sentAt) VALUES
			(${KEPT}, 'gate', 'B12', 1), (${JOINED}, 'gate', 'B12', 2), (${JOINED}, 'delay', '15', 3)
	`
	yield* sql`INSERT INTO deliveries (bookingId, category, value, sentAt, token) VALUES (${JOINED}, 'delay', '15', 3, 'device')`
	yield* sql`INSERT INTO requests (bookingId, at) VALUES (${JOINED}, 4)`
})

it.layer(store)(test =>
	test.effect(
		'joins rows of one service into one flight, each row a traveller under its own reservation, and moves their push records to it',
		Effect.fnUntraced(function* () {
			const sql = yield* SqlClient.SqlClient
			yield* tickets
			yield* migrate('9999')
			assert.deepStrictEqual(
				[
					yield* sql`SELECT name FROM pragma_table_info('flights') ORDER BY cid`,
					yield* sql`SELECT id, number, departs, coalesce(boardingAt, 0) AS boardingAt, travellers FROM flights ORDER BY rowid`,
					yield* sql`SELECT channel, bookingId FROM activities ORDER BY channel`,
					yield* sql`SELECT channel, props FROM retirements`,
					yield* sql`SELECT bookingId, category, value FROM sent_alerts ORDER BY sentAt`,
					yield* sql`SELECT bookingId FROM deliveries`,
					yield* sql`SELECT bookingId, at FROM requests`
				],
				[
					Array.map(
						[
							'id',
							'airline',
							'airlineCode',
							'number',
							'from',
							'to',
							'departs',
							'arrives',
							'boardingAt',
							'live',
							'travellers'
						],
						name => ({name})
					),
					[
						{
							boardingAt: DEPARTS - 1_800_000,
							departs: DEPARTS,
							id: KEPT,
							number: '1234',
							travellers:
								'[{"confirmation":"ONE","seat":"11A","status":"confirmed"},{"confirmation":"TWO","seat":"11B","status":"confirmed"}]'
						},
						{boardingAt: 0, departs: DEPARTS, id: OTHER, number: '553', travellers: '[{"status":"cancelled"}]'},
						// The same number nineteen hours later, on the next day, is another service.
						{
							boardingAt: 0,
							departs: DEPARTS + 68_400_000,
							id: NEXT_DAY,
							number: '1234',
							travellers: '[{"confirmation":"ONE","seat":"11A","status":"confirmed"}]'
						}
					],
					[
						{bookingId: KEPT, channel: 'kept'},
						{bookingId: KEPT, channel: 'moved'}
					],
					[{channel: 'clash', props: '{}'}],
					[
						{bookingId: KEPT, category: 'gate', value: 'B12'},
						{bookingId: KEPT, category: 'delay', value: '15'}
					],
					[{bookingId: KEPT}],
					[{at: 4, bookingId: KEPT}]
				]
			)
		})
	)
)
