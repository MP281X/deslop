import {Boolean, Option, Predicate} from 'effect'

import {problemScreen} from '@deslop/components/shell'

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

export function Workspace<H, C, S>(host: H, screen: DeployScreen, ui: DeployUi<H, C, S>) {
	if (screen.problem !== undefined) {
		return problemScreen(host, ui, {
			text: screen.problem.text,
			...Boolean.match(screen.problem.back, {
				onFalse: () => ({}),
				onTrue: () => ({back: {label: 'Back to Deploy', press: screen.selection.back}})
			}),
			...Boolean.match(screen.problem.signIn, {
				onFalse: () => ({}),
				onTrue: () => ({signIn: {press: screen.authenticate, running: screen.signingIn}})
			})
		})
	}
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
