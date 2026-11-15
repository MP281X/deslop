import {Effect, Stream} from 'effect'

import {SqlClient} from 'effect/sql'

import {identifyRequestOf} from '@deslop/runtime/server/auth'
import {CurrentUser} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {CookieSessions} from '#services/cookie-sessions/service.ts'
import {Identity} from '#services/identity/service.ts'
import {People} from '#services/people/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const people = yield* People
		const sessions = yield* CookieSessions
		const identity = yield* Identity
		const sql = yield* SqlClient.SqlClient
		return RpcContracts.of({
			'people.account': (_, options) =>
				sql.reactive(['people', 'cookieSessions'], identity.resolve(identifyRequestOf(options.headers), true)),
			'people.admit': Effect.fnUntraced(function* (input) {
				return yield* people.admit(input, yield* CurrentUser)
			}),
			'people.watch': () => Stream.unwrap(Effect.map(CurrentUser, user => sql.reactive(['people'], people.list(user)))),
			'sessions.watch': () =>
				Stream.unwrap(Effect.map(CurrentUser, user => sql.reactive(['cookieSessions'], sessions.list(user.id))))
		})
	})
)
