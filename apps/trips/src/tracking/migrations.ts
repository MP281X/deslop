import {Effect} from 'effect'

import {SqlClient} from 'effect/sql'

export const migrations = {
	'0001_lookups': Effect.gen(function* () {
		yield* (yield* SqlClient.SqlClient)`CREATE TABLE lookups (month TEXT PRIMARY KEY, calls INTEGER NOT NULL) STRICT`
	})
}
