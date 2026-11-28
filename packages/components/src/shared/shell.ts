import {Boolean, Function, Option, pipe} from 'effect'

import type {Components} from '#src/shared/components.ts'
import type {Press} from '#src/shared/model.ts'

// The screen in place of an app's content when the shell finds a refusal or a sign-in to make, or the app has a way out of its own.
export function problemScreen<H, C, S>(
	host: H,
	ui: Components<H, C, S>,
	problem: {
		readonly text: string
		readonly back?: {readonly label: string; readonly press: Press}
		readonly signIn?: {readonly press: Press; readonly running: boolean}
	}
) {
	const signingIn = problem.signIn?.running === true
	return ui.layout(host, {
		content: ui.message(
			host,
			Boolean.match(signingIn, {onFalse: Function.constant(problem.text), onTrue: Function.constant('Signing in…')}),
			[
				...pipe(
					Option.fromUndefinedOr(problem.signIn),
					Option.filter(() => !signingIn),
					Option.map(signIn => ui.button(host, {label: 'Continue with GitHub', press: signIn.press})),
					Option.toArray
				),
				...pipe(
					Option.fromUndefinedOr(problem.back),
					Option.map(back => ui.button(host, {label: back.label, press: back.press})),
					Option.toArray
				)
			]
		)
	})
}
