import type {Components} from '@deslop/components/components'
import {workspace} from '@deslop/components/shell'

import type {ItemsScreen} from '#app'

import {itemRows, listRows} from '#items/view.ts'

function detailRows<H, C, S>(host: H, screen: ItemsScreen, ui: Components<H, C, S>) {
	if (screen.loading) return [ui.skeleton(host)]
	if (screen.failed) return [ui.notice(host, 'Couldn’t load items', screen.retry)]
	if (screen.detail !== undefined) return itemRows(host, screen.detail, ui)
	if (screen.missing) return [ui.notice(host, 'Item not found')]
	return undefined
}

export function Workspace<H, C, S>(host: H, screen: ItemsScreen, ui: Components<H, C, S>) {
	return workspace(host, ui, screen, {
		backLabel: 'Back to items',
		detail: detailRows(host, screen, ui),
		list: active => ui.view(host, {key: 'items'}, listRows(host, screen, active, ui))
	})
}
