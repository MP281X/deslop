import {Effect, Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {AuthError, CurrentUser} from '@deslop/runtime/shared/auth'

import {CookieSession} from '#server/sessions/schema.ts'
import {Sessions} from '#server/sessions/service.ts'

export const SessionTools = Toolkit.make(
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

export const SessionToolHandlers = SessionTools.toLayer(
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
