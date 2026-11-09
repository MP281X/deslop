import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {AuthError} from '@deslop/runtime/auth/schema'

import {Person} from '#services/people/schema.ts'
import {CurrentOwner} from '#services/tokens/schema.ts'

// The tool acts as the signed-in caller, which the MCP sign-in middleware provides per request.
export const Tools = Toolkit.make(
	Tool.make('answer_request', {
		dependencies: [CurrentOwner],
		description:
			'Approve or deny an app or agent sign-in you started, by the code its page or authorize redirect shows (WDJB-MJHT). Never answer a code you did not start; browser sign-ins are approved only in a browser.',
		failure: AuthError,
		parameters: Schema.Struct({accept: Schema.Boolean, request: Schema.NonEmptyString.check(Schema.isMaxLength(20))}),
		success: Schema.Struct({clientName: Schema.String})
	}).annotate(Tool.Destructive, false),
	Tool.make('list_sessions', {
		dependencies: [CurrentOwner],
		description:
			'Each signed-in client of yours with its id, device, last activity and address; sign one out with sign_out_session.',
		failure: AuthError,
		parameters: Tool.EmptyParams,
		success: Schema.Struct({
			sessions: Schema.Array(
				Schema.Struct({
					address: Schema.optionalKey(Schema.String),
					client: Schema.String,
					device: Schema.String,
					id: Schema.NonEmptyString,
					lastActive: Schema.Finite
				})
			)
		})
	}).annotate(Tool.Readonly, true),
	Tool.make('sign_out_session', {
		dependencies: [CurrentOwner],
		description: 'Sign a client out of every app by the id list_sessions returns.',
		failure: AuthError,
		parameters: Schema.Struct({id: Schema.NonEmptyString}),
		success: Schema.Struct({id: Schema.NonEmptyString})
	}).annotate(Tool.Destructive, true),
	Tool.make('remove_person', {
		dependencies: [CurrentOwner],
		description: 'Remove a member by their GitHub login; admins cannot be removed.',
		failure: AuthError,
		parameters: Schema.Struct({login: Schema.NonEmptyString}),
		success: Person
	}).annotate(Tool.Destructive, true)
)
