import {Context, Effect, Layer, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {ReadingPosition, ReadingError} from './schema.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly reading: never
	}
}

export class Reading extends Context.Service<Reading>()('@deslop/opm/services/reading/service/Reading', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)
		const write = SqlSchema.void({
			Request: ReadingPosition.insert,
			execute: row => sql`
				INSERT INTO ${sql(ReadingPosition.table)} ${sql.insert(row)}
				ON CONFLICT (series, number) DO UPDATE SET done = excluded.done, page = excluded.page
			`
		})
		return {
			write: Effect.fn('Reading.write')(function* (update: typeof ReadingPosition.insert.Type) {
				yield* Effect.annotateCurrentSpan({
					chapter: update.number,
					done: update.done,
					page: update.page,
					series: update.series
				})
				yield* pipe(
					write(update),
					Reactivity.mutation(['reading']),
					Effect.mapError(cause => ReadingError.make({cause, message: 'The reading position could not be saved.'}))
				)
			}, withReactivity)
		}
	})
}) {
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({
			loader: Migrator.fromRecord({
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
			}),
			table: 'reading_migrations'
		})
	)

	static readonly layer = Layer.effect(this, this.make)
}
