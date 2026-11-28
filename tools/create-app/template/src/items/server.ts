import {Context, Effect, Layer, Schema} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {Item, ItemsError} from './contract.ts'
import {migrations} from './migrations.ts'

export class Items extends Context.Service<Items>()('@deslop/template-app/items/server/Items', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const listItems = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Item,
			execute: () => sql`SELECT * FROM ${sql(Item.table)} ORDER BY title`
		})
		const items = Effect.mapError(listItems(), cause =>
			ItemsError.make({cause, message: 'The items could not be read.'})
		)
		return {
			// The items now, and again after each change to them.
			watch: Reactivity.stream(items, ['items'])
		}
	})
}) {
	// The table this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({loader: Migrator.fromRecord(migrations), table: 'items_migrations'})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly items: never
	}
}
