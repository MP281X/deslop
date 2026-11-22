import {Array, Effect, Option, Schema, Stream, pipe} from 'effect'

import {SqlClient} from 'effect/sql'

import {identifyRequestOf} from '@deslop/runtime/server/auth'
import {CurrentAdmin, CurrentUser} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Identity} from '#services/identity/service.ts'
import {People} from '#services/people/service.ts'
import {ListedSession} from '#services/sessions/schema.ts'
import {Sessions} from '#services/sessions/service.ts'

// A slow subscriber holds only the newest pending answer.
function latest<A, E, R>(stream: Stream.Stream<A, E, R>) {
	return Stream.buffer(stream, {capacity: 1, strategy: 'sliding'})
}

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const people = yield* People
		const sessions = yield* Sessions
		const identity = yield* Identity
		const sql = yield* SqlClient.SqlClient
		return RpcContracts.of({
			'people.account': (_, options) =>
				latest(sql.reactive(['people', 'sessions'], identity.resolve(identifyRequestOf(options.headers), true))),
			'people.admit': Effect.fnUntraced(function* (input) {
				return yield* people.admit(input, yield* CurrentAdmin)
			}),
			'people.watch': () =>
				Stream.unwrap(Effect.map(CurrentAdmin, admin => latest(sql.reactive(['people'], people.list(admin))))),
			'sessions.watch': (_, options) =>
				Stream.unwrap(
					Effect.gen(function* () {
						const user = yield* CurrentUser
						const own = yield* Option.match(identifyRequestOf(options.headers).session, {
							onNone: () => Effect.succeedNone,
							onSome: sessions.current
						})
						const listed = Effect.map(
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
						// Using a session moves it up without telling anyone, and a session expires by the clock alone, so the open list also reads again each minute.
						return pipe(
							Stream.tick('1 minute'),
							Stream.switchMap(() => sql.reactive(['sessions'], listed)),
							Stream.changesWith(Schema.toEquivalence(Schema.Array(ListedSession))),
							latest
						)
					})
				)
		})
	})
)
