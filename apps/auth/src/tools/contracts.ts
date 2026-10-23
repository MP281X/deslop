import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {AuthError} from '@deslop/runtime/auth/schema'

import {Person} from '#services/authorizations/schema.ts'

export const Tools = Toolkit.make(
	Tool.make('answer_request', {
		description:
			'Approve or deny a waiting sign-in as the signed-in account, as entering its code at https://auth.mp281x.xyz does. Pass the code its sign-in page shows, such as WDJB-MJHT. The waiting page then completes or fails the sign-in by itself.',
		failure: AuthError,
		parameters: Schema.Struct({accept: Schema.Boolean, request: Schema.NonEmptyString}),
		success: Schema.Struct({clientName: Schema.String})
	}).annotate(Tool.Destructive, false),
	Tool.make('list_people', {
		description:
			'For an admin: the GitHub accounts asking for access, newest first, and everyone with access. Admins come from GITHUB_ADMINS; members are accounts an admin allowed.',
		failure: AuthError,
		success: Schema.Struct({people: Schema.Array(Person)})
	}).annotate(Tool.Readonly, true),
	Tool.make('answer_access_request', {
		description:
			'For an admin: allow or decline a GitHub account asking for access, by its login from list_people. Allow only an account the user named; a declined account can sign in again to ask again.',
		failure: AuthError,
		parameters: Schema.Struct({allow: Schema.Boolean, login: Schema.NonEmptyString}),
		success: Schema.Struct({person: Person})
	}).annotate(Tool.Destructive, false),
	Tool.make('remove_person', {
		description:
			'For an admin: take access away from a member, by login. It signs them out of every app; admins cannot be removed.',
		failure: AuthError,
		parameters: Schema.Struct({login: Schema.NonEmptyString}),
		success: Schema.Struct({person: Person})
	}).annotate(Tool.Destructive, true)
)
