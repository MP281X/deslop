import {Array, Effect, Option, Stream} from 'effect'

import {SqlClient} from 'effect/sql'

import {identifyRequestOf} from '@deslop/runtime/server/auth'
import {CurrentUser} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {ListedSession} from '#services/cookie-sessions/schema.ts'
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
			'sessions.watch': (_, options) =>
				Stream.unwrap(
					Effect.gen(function* () {
						const user = yield* CurrentUser
						const own = yield* Option.match(identifyRequestOf(options.headers).session, {
							onNone: () => Effect.succeedNone,
							onSome: sessions.current
						})
						return sql.reactive(
							['cookieSessions'],
							Effect.map(
								sessions.list(user.id),
								Array.map(row =>
									ListedSession.make({
										address: row.address,
										browser: row.browser,
										current: Option.exists(own, found => found.id === row.id),
										id: row.id,
										lastSeenAt: row.lastSeenAt
									})
								)
							)
						)
					})
				)
		})
	})
)
