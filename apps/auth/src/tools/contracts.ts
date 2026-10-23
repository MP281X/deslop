import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {AuthError} from '@deslop/runtime/auth/schema'

import {PendingAuthorization} from '#services/authorizations/schema.ts'

export const Tools = Toolkit.make(
	Tool.make('list_requests', {
		description:
			'List the sign-ins waiting for approval, newest first, as https://auth.mp281x.xyz shows them: the client, the callback it returns to, the apps it asks for and when it expires. Each id starts with the request code its sign-in page shows, such as j_yv-eHBa for j_yveHBa….',
		failure: AuthError,
		success: Schema.Struct({requests: Schema.Array(PendingAuthorization)})
	}).annotate(Tool.Readonly, true),
	Tool.make('answer_request', {
		description:
			'Approve or deny a waiting sign-in, as the Approve and Deny buttons on https://auth.mp281x.xyz do. Pass the request code its sign-in page shows, such as j_yv-eHBa, or its id from list_requests. The waiting page then completes or fails the sign-in by itself.',
		failure: AuthError,
		parameters: Schema.Struct({accept: Schema.Boolean, request: Schema.NonEmptyString}),
		success: Schema.Struct({clientName: Schema.String})
	}).annotate(Tool.Destructive, false)
)
