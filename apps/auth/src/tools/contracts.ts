import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {AuthError} from '@deslop/runtime/auth/schema'
import {CurrentUser} from '@deslop/runtime/auth/utils'

// The tool acts as the signed-in caller, which the MCP sign-in middleware provides per request.
export const Tools = Toolkit.make(
	Tool.make('answer_request', {
		dependencies: [CurrentUser],
		description:
			'Approve or deny an app or agent sign-in you started, by the code its page or authorize redirect shows (WDJB-MJHT). Never answer a code you did not start; browser sign-ins are approved only in a browser.',
		failure: AuthError,
		parameters: Schema.Struct({accept: Schema.Boolean, request: Schema.NonEmptyString.check(Schema.isMaxLength(20))}),
		success: Schema.Struct({clientName: Schema.String})
	}).annotate(Tool.Destructive, false)
)
