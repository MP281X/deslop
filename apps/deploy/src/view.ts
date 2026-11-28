import {Array, Boolean, Function, Option, Predicate} from 'effect'

import type {DeployScreen} from '#app'

import {exposeSheet} from '#exposures/view.ts'
import type {DeployUi, SheetCommon} from '#exposures/view.ts'
import {actionSheet, appRows, listRows} from '#inventory/view.ts'
import {overview} from '#machine/view.ts'

function detailRows<H, C, S>(host: H, screen: DeployScreen, ui: DeployUi<H, C, S>) {
	if (screen.loading) return [ui.skeleton(host)]
	if (screen.inventoryFailed) return [ui.notice(host, 'Couldn’t load apps', screen.retry)]
	if (screen.machineSelected) return overview(host, screen, ui)
	if (screen.detail === undefined) {
		if (screen.missing) return [ui.notice(host, 'App not found')]
		return overview(host, screen, ui)
	}
	return appRows(host, screen, screen.detail, ui)
}

function sheet<H, C, S>(host: H, screen: DeployScreen, ui: DeployUi<H, C, S>) {
	if (screen.dialog === undefined) return undefined
	const common = {
		dismiss: screen.dismiss,
		label: screen.dialog.label,
		open: true,
		pending: screen.dialog.pending,
		toolbar: {actions: screen.dialog.toolbar, choose: screen.choose}
	} satisfies SheetCommon<C>
	if (Predicate.isTagged(screen.dialog, 'Expose')) return exposeSheet(host, screen, ui, screen.dialog, common)
	return actionSheet(host, ui, screen.dialog, common)
}

function problemScreen<H, C, S>(
	host: H,
	screen: DeployScreen,
	problem: NonNullable<DeployScreen['problem']>,
	ui: DeployUi<H, C, S>
) {
	return ui.layout(host, {
		content: ui.message(
			host,
			Boolean.match(screen.signingIn, {
				onFalse: Function.constant(problem.text),
				onTrue: Function.constant('Signing in…')
			}),
			[
				...Boolean.match(problem.signIn === true && !screen.signingIn, {
					onFalse: Array.empty<C>,
					onTrue: () => [ui.button(host, {label: 'Continue with GitHub', press: screen.authenticate})]
				}),
				...Boolean.match(problem.back === true, {
					onFalse: Array.empty<C>,
					onTrue: () => [ui.button(host, {label: 'Back to Deploy', press: screen.selection.back})]
				})
			]
		)
	})
}

export function Workspace<H, C, S>(host: H, screen: DeployScreen, ui: DeployUi<H, C, S>) {
	if (screen.problem !== undefined) return problemScreen(host, screen, screen.problem, ui)
	return ui.listDetail(host, {
		defaultId: screen.id,
		...Option.match(Option.fromUndefinedOr(detailRows(host, screen, ui)), {
			onNone: () => ({}),
			onSome: detail => ({detail})
		}),
		detailToolbar: screen.actions,
		list: (active, wide) => ui.view(host, {key: 'apps'}, listRows(host, screen, active, wide, ui)),
		loading: screen.loading,
		selection: screen.selection,
		sheet: sheet(host, screen, ui),
		toolbar: {actions: [], choose: screen.choose}
	})
}
