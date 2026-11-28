import {Array, Effect, Option, Schema, Stream, pipe} from 'effect'

import {Tool, Toolkit} from 'effect/ai'
import {SqlClient} from 'effect/sql'

import {identifyRequestOf} from '@deslop/runtime/server/auth'
import {AuthError, CurrentUser} from '@deslop/runtime/shared/auth'

import {ListedSession, SessionsRpcs, CookieSession} from './contract.ts'
import {Sessions} from './server.ts'

export const sessionsTools = Toolkit.make(
	Tool.make('list_sessions', {
		dependencies: [CurrentUser],
		description: 'List your browser sessions, newest activity first.',
		failure: AuthError,
		parameters: Tool.EmptyParams,
		success: Schema.Struct({sessions: Schema.Array(CookieSession)})
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Destructive, false)
		.annotate(Tool.Strict, true),
	Tool.make('sign_out_session', {
		dependencies: [CurrentUser],
		description: 'Sign out one of your browser sessions by the id list_sessions returns.',
		failure: AuthError,
		parameters: Schema.Struct({id: Schema.String}),
		success: Schema.Struct({id: Schema.String})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true)
)

export const sessionsToolHandlers = sessionsTools.toLayer(
	Effect.map(Sessions, sessions => ({
		list_sessions: Effect.fnUntraced(function* () {
			return {sessions: yield* sessions.list((yield* CurrentUser).id)}
		}),
		sign_out_session: Effect.fnUntraced(function* (input) {
			yield* sessions.remove(input.id, (yield* CurrentUser).id)
			return {id: input.id}
		})
	}))
)

export const sessionsHandlers = SessionsRpcs.toLayer(
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
