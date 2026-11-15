import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {AuthError, CurrentUser, UserId} from '@deslop/runtime/shared/auth'

import {CookieSession} from '#services/cookie-sessions/schema.ts'
import {Person} from '#services/people/schema.ts'

export const ToolContracts = Toolkit.make(
	Tool.make('list_people', {
		dependencies: [CurrentUser],
		description: 'List people and access requests. Only admins may list people.',
		failure: AuthError,
		parameters: Tool.EmptyParams,
		success: Schema.Struct({people: Schema.Array(Person)})
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Destructive, false),
	Tool.make('remove_person', {
		dependencies: [CurrentUser],
		description:
			'Remove a person and their browser sessions by id. Admins cannot be removed. Tailnet people return on their next request.',
		failure: AuthError,
		parameters: Schema.Struct({id: UserId}),
		success: Person
	}).annotate(Tool.Destructive, true),
	Tool.make('list_sessions', {
		dependencies: [CurrentUser],
		description: 'List your browser sessions, newest activity first.',
		failure: AuthError,
		parameters: Tool.EmptyParams,
		success: Schema.Struct({sessions: Schema.Array(CookieSession)})
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Destructive, false),
	Tool.make('sign_out_session', {
		dependencies: [CurrentUser],
		description: 'Sign out one of your browser sessions by the id list_sessions returns.',
		failure: AuthError,
		parameters: Schema.Struct({id: Schema.String}),
		success: Schema.Struct({id: Schema.String})
	}).annotate(Tool.Destructive, true)
)
