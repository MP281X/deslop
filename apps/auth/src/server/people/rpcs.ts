import {Effect, Stream} from 'effect'

import {SqlClient} from 'effect/sql'

import {CurrentAdmin} from '@deslop/runtime/shared/auth'

import {PeopleRpcs} from '#contracts'

import {People} from '#server/people/service.ts'

export const PeopleRpcHandlers = PeopleRpcs.toLayer(
	Effect.gen(function* () {
		const people = yield* People
		const sql = yield* SqlClient.SqlClient
		return {
			'people.admit': Effect.fnUntraced(function* (input) {
				return yield* people.admit(input, yield* CurrentAdmin)
			}),
			'people.watch': () =>
				Stream.unwrap(
					Effect.map(CurrentAdmin, admin =>
						Stream.buffer(sql.reactive(['people'], people.list(admin)), {capacity: 1, strategy: 'sliding'})
					)
				)
		}
	})
)
