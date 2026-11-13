import {Context, Effect, Layer, pipe} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {SqlClient, SqlSchema} from 'effect/sql'

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
	static readonly layer = Layer.effect(this, this.make)
}
