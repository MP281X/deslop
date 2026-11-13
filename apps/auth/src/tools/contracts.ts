import {Effect, Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {AuthError} from '@deslop/runtime/shared/auth'

import {Passkey} from '#services/passkeys/schema.ts'
import {Role} from '#services/people/schema.ts'
import {CurrentOwner} from '#services/tokens/schema.ts'

type Page = typeof Page.Type
const Page = Schema.Struct({
	cursor: Schema.optionalKey(Schema.NonEmptyString),
	limit: Schema.withDecodingDefaultTypeKey<typeof Schema.Int>(Effect.succeed(30))(
		Schema.Int.check(Schema.isBetween({maximum: 100, minimum: 1}))
	)
})

// The tool acts as the signed-in caller, which the MCP sign-in middleware provides per request.
export const ToolContracts = Toolkit.make(
	Tool.make('answer_sign_in', {
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
	})
		.annotate(Tool.Destructive, false)
		.annotate(Tool.Strict, true),
	Tool.make('list_sessions', {
		dependencies: [CurrentOwner],
		description:
			'List signed-in devices and agents with ISO last activity; pass nextCursor unchanged to continue. Use sign_out_session(id) only for a user-requested revocation.',
		failure: AuthError,
		parameters: Page,
		success: Schema.Struct({
			nextCursor: Schema.optionalKey(Schema.String),
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
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true),
	Tool.make('sign_out_session', {
		dependencies: [CurrentOwner],
		description:
			'Use when the user asks to sign out a device or app; signs it out of every Deslop app by the id list_sessions returns.',
		failure: AuthError,
		parameters: Schema.Struct({id: Schema.NonEmptyString.annotate({description: 'A session id from list_sessions.'})}),
		success: Schema.Struct({id: Schema.NonEmptyString})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true),
	Tool.make('list_passkeys', {
		dependencies: [CurrentOwner],
		description:
			'List sign-in passkeys; addedFrom is their registration origin, not their current location, and synced distinguishes device-bound credentials. Continue with nextCursor or use remove_passkey(id) for an explicit removal request.',
		failure: AuthError,
		parameters: Page,
		success: Schema.Struct({nextCursor: Schema.optionalKey(Schema.String), passkeys: Schema.Array(Passkey.json)})
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true),
	Tool.make('remove_passkey', {
		dependencies: [CurrentOwner],
		description: 'Use when the user asks to remove a passkey; removes it by the id list_passkeys returns.',
		failure: AuthError,
		parameters: Schema.Struct({id: Schema.NonEmptyString.annotate({description: 'A passkey id from list_passkeys.'})}),
		success: Schema.Struct({id: Schema.NonEmptyString})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true),
	Tool.make('list_people', {
		dependencies: [CurrentOwner],
		description:
			'List allowed and waiting GitHub accounts with their roles; pass nextCursor unchanged to continue. Use remove_person(login) only for the account the user requests; admins cannot be removed.',
		failure: AuthError,
		parameters: Page,
		success: Schema.Struct({
			nextCursor: Schema.optionalKey(Schema.String),
			people: Schema.Array(Schema.Struct({login: Schema.NonEmptyString, role: Role}))
		})
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true),
	Tool.make('remove_person', {
		dependencies: [CurrentOwner],
		description:
			"Use when the user asks to remove someone's access; removes the member by the GitHub login list_people returns, and admins cannot be removed.",
		failure: AuthError,
		parameters: Schema.Struct({
			login: Schema.NonEmptyString.annotate({description: 'The GitHub login from list_people.'})
		}),
		success: Schema.Struct({login: Schema.NonEmptyString})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true)
)
