import {Array, Effect, Option, Schema, Stream, pipe} from 'effect'

import {SqlClient} from 'effect/sql'

import {identifyRequestOf} from '@deslop/runtime/server/auth'
import {CurrentUser} from '@deslop/runtime/shared/auth'

import {ListedSession, SessionsRpcs} from '#contracts'

import {Sessions} from '#server/sessions/service.ts'

export const SessionsRpcHandlers = SessionsRpcs.toLayer(
	Effect.gen(function* () {
		const sessions = yield* Sessions
		const sql = yield* SqlClient.SqlClient
		return {
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
							Stream.buffer({capacity: 1, strategy: 'sliding'})
						)
					})
				)
		}
	})
)
