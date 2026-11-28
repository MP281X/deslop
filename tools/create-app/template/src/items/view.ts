import {Array} from 'effect'

import type {Components} from '@deslop/components/components'
import type {Selection} from '@deslop/components/model'

import type {ItemsScreen} from '#app'

import type {Item} from './contract.ts'

export function listRows<H, C, S>(host: H, screen: ItemsScreen, active: Selection['id'], ui: Components<H, C, S>) {
	const rows = Array.map(screen.list, item =>
		ui.row(host, {active: item.id === active, item, select: screen.selection.select})
	)
	if (screen.listStatus !== undefined) return [...rows, ui.notice(host, screen.listStatus, screen.retry)]
	if (Array.isReadonlyArrayEmpty(rows)) return [...rows, ui.notice(host, 'No items')]
	return rows
}

export function itemRows<H, C, S>(host: H, item: Item, ui: Components<H, C, S>) {
	return [ui.headline(host, item.title), ui.caption(host, item.line), ui.paragraph(host, item.body)]
}
