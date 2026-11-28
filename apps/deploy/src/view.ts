import {Predicate} from 'effect'

import type {Components} from '@deslop/components/components'
import type {PaneLeaf, Press, SheetOptions} from '@deslop/components/model'
import {workspace} from '@deslop/components/shell'

import type {DeployScreen} from '#app'

import {exposeSheetOptions} from '#exposures/view.ts'
import {actionSheet, appRows, listRows} from '#inventory/view.ts'
import {overview} from '#machine/view.ts'

export type SiteRow = NonNullable<DeployScreen['detail']>['exposures'][number]
export type SheetCommon<C> = {
	readonly dismiss: DeployScreen['dismiss']
	readonly label: string
	readonly open: true
	readonly pending: boolean
	readonly toolbar: SheetOptions<C>['toolbar']
}

// The one piece the hosts draw differently: the web links out, the iPhone presses.
export type DeployUi<H, C, S> = Components<H, C, S> & {
	site: (host: H, site: SiteRow, open: (url: string) => Press) => PaneLeaf<C>
}

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
	if (Predicate.isTagged(screen.dialog, 'Expose')) return exposeSheetOptions(host, screen, ui, screen.dialog, common)
	return actionSheet(host, ui, screen.dialog, common)
}

export function Workspace<H, C, S>(host: H, screen: DeployScreen, ui: DeployUi<H, C, S>) {
	return workspace(host, ui, screen, {
		backLabel: 'Back to Deploy',
		detail: detailRows(host, screen, ui),
		detailToolbar: screen.actions,
		list: (active, wide) => ui.view(host, {key: 'apps'}, listRows(host, screen, active, wide, ui)),
		sheet: sheet(host, screen, ui),
		toolbar: {actions: [], choose: screen.choose}
	})
}
