import {Boolean, Function, Option, pipe} from 'effect'

import type {Components} from '#src/shared/components.ts'
import type {Absent, ListOptions, Press, Selection} from '#src/shared/model.ts'

// The screen in place of an app's content when the shell finds a refusal or a sign-in to make, or the app has a way out of its own.
function problemScreen<H, C, S>(
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

// An app's whole screen: the shell's problem when there is one, else its list beside its detail.
export function workspace<H, C, S>(
	host: H,
	ui: Components<H, C, S>,
	screen: {
		readonly authenticate: Press
		readonly id: string | Absent
		readonly loading: boolean
		readonly problem: {readonly back: boolean; readonly signIn: boolean; readonly text: string} | Absent
		readonly selection: Selection
		readonly signingIn: boolean
	},
	options: {
		readonly backLabel: string
		readonly detail: ListOptions<C>['detail']
		readonly detailToolbar?: ListOptions<C>['detailToolbar']
		readonly list?: ListOptions<C>['list']
		readonly sheet?: ListOptions<C>['sheet']
		readonly toolbar?: ListOptions<C>['toolbar']
	}
) {
	if (screen.problem !== undefined) {
		return problemScreen(host, ui, {
			text: screen.problem.text,
			...Boolean.match(screen.problem.back, {
				onFalse: () => ({}),
				onTrue: () => ({back: {label: options.backLabel, press: screen.selection.back}})
			}),
			...Boolean.match(screen.problem.signIn, {
				onFalse: () => ({}),
				onTrue: () => ({signIn: {press: screen.authenticate, running: screen.signingIn}})
			})
		})
	}
	return ui.listDetail(host, {
		defaultId: screen.id,
		detailToolbar: options.detailToolbar,
		...Option.match(Option.fromUndefinedOr(options.detail), {
			onNone: () => ({}),
			onSome: content => ({detail: content})
		}),
		list: options.list,
		loading: screen.loading,
		selection: screen.selection,
		sheet: options.sheet,
		toolbar: options.toolbar
	})
}
