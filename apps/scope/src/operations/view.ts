import {Array, Boolean, Function} from 'effect'

import type {Selection} from '@deslop/components/model'

import type {ScopeScreen} from '#app'
import type {Failure} from '#reads'
import type {ScopeUi} from '#view'

// Why a read shows no content, as a notice with the action that answers it.
export function failureNotice<H, C, S>(host: H, screen: ScopeScreen, ui: ScopeUi<H, C, S>, failure: Failure) {
	if (failure === 'denied') return ui.problem(host, 'Access denied')
	const problem = screen.problem
	if (failure === 'sign-in' && problem !== undefined) {
		return ui.problem(
			host,
			Boolean.match(ui.leaves && problem.signIn && !problem.signInFailed, {
				onFalse: () => problem.text,
				onTrue: Function.constant('Signing in…')
			}),
			{label: 'Sign in', press: screen.authenticate}
		)
	}
	return ui.problem(host, 'Couldn’t load', {label: 'Retry', press: screen.retry})
}

// The chosen app's operations and the chosen operation's traces, each as a row a hover can name.
export function listRows<H, C, S>(host: H, screen: ScopeScreen, ui: ScopeUi<H, C, S>, activeId: Selection['id']) {
	return {
		operations: Array.map(screen.operations, row =>
			ui.entry(
				host,
				row.item.id,
				Boolean.match(row.item.problem === undefined, {onFalse: () => row.hint, onTrue: () => row.item.title}),
				ui.row(host, {active: row.item.id === activeId, item: row.item, select: screen.selection.select})
			)
		),
		traces: Array.map(screen.traces, item =>
			ui.entry(
				host,
				item.id,
				item.problem?.reason,
				ui.row(host, {
					active: activeId !== undefined && item.id === screen.activeTrace,
					item,
					select: screen.selection.select
				})
			)
		)
	}
}
