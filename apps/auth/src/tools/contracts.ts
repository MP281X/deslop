import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {AuthError} from '@deslop/runtime/auth/schema'

import {Passkey} from '#services/passkeys/schema.ts'
import {Role} from '#services/people/schema.ts'
import {CurrentOwner} from '#services/tokens/schema.ts'

// The tool acts as the signed-in caller, which the MCP sign-in middleware provides per request.
export const Tools = Toolkit.make(
	Tool.make('answer_request', {
		dependencies: [CurrentOwner],
		description:
			'Approve or deny an app or agent sign-in you started, by the code its page or authorize redirect shows (WDJB-MJHT). Never answer a code you did not start; browser sign-ins are approved only in a browser.',
		failure: AuthError,
		parameters: Schema.Struct({
			accept: Schema.Boolean.annotate({description: 'True to approve, false to deny.'}),
			request: Schema.NonEmptyString.check(Schema.isMaxLength(20)).annotate({
				description: 'The code the sign-in shows (WDJB-MJHT).'
			})
		}),
		success: Schema.Struct({clientName: Schema.String})
	}).annotate(Tool.Destructive, false),
	Tool.make('list_sessions', {
		dependencies: [CurrentOwner],
		description:
			"Use when the user asks to sign a device out or see where they are signed in; returns each session's id, client, address, device when it differs from the address, and last activity as ISO-8601.",
		failure: AuthError,
		parameters: Tool.EmptyParams,
		success: Schema.Struct({
			sessions: Schema.Array(
				Schema.Struct({
					address: Schema.optionalKey(Schema.String),
					client: Schema.String,
					device: Schema.optionalKey(Schema.String),
					id: Schema.NonEmptyString,
					lastActive: Schema.String
				})
			)
		})
	}).annotate(Tool.Readonly, true),
	Tool.make('sign_out_session', {
		dependencies: [CurrentOwner],
		description:
			'Use when the user asks to sign out a device or app; signs it out of every Deslop app by the id list_sessions returns.',
		failure: AuthError,
		parameters: Schema.Struct({id: Schema.NonEmptyString.annotate({description: 'A session id from list_sessions.'})}),
		success: Schema.Struct({id: Schema.NonEmptyString})
	}).annotate(Tool.Destructive, true),
	Tool.make('list_passkeys', {
		dependencies: [CurrentOwner],
		description:
			"Use when the user asks which passkeys can sign them in; returns each passkey's id, browser and device, and whether it is synced.",
		failure: AuthError,
		parameters: Tool.EmptyParams,
		success: Schema.Struct({passkeys: Schema.Array(Passkey)})
	}).annotate(Tool.Readonly, true),
	Tool.make('remove_passkey', {
		dependencies: [CurrentOwner],
		description: 'Use when the user asks to remove a passkey; removes it by the id list_passkeys returns.',
		failure: AuthError,
		parameters: Schema.Struct({id: Schema.NonEmptyString.annotate({description: 'A passkey id from list_passkeys.'})}),
		success: Schema.Struct({id: Schema.NonEmptyString})
	}).annotate(Tool.Destructive, true),
	Tool.make('list_people', {
		dependencies: [CurrentOwner],
		description:
			"Use when the user asks who is allowed into their apps or you need the GitHub login to remove someone; returns each person's login and role (Admin, Member or Waiting).",
		failure: AuthError,
		parameters: Tool.EmptyParams,
		success: Schema.Struct({people: Schema.Array(Schema.Struct({login: Schema.NonEmptyString, role: Role}))})
	}).annotate(Tool.Readonly, true),
	Tool.make('remove_person', {
		dependencies: [CurrentOwner],
		description:
			"Use when the user asks to remove someone's access; removes the member by the GitHub login list_people returns, and admins cannot be removed.",
		failure: AuthError,
		parameters: Schema.Struct({
			login: Schema.NonEmptyString.annotate({description: 'The GitHub login from list_people.'})
		}),
		success: Schema.Struct({login: Schema.NonEmptyString})
	}).annotate(Tool.Destructive, true)
)
