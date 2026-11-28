import {Array, Boolean} from 'effect'

import type {Selection} from '@deslop/components/model'
import {workspace} from '@deslop/components/shell'
import {styles} from '@deslop/components/styles'

import type {AuthUi, Kind} from '#view'

import type {Entry} from './screen.ts'

export const AVATAR = {
	alignItems: 'center',
	backgroundColor: '#202020',
	borderRadius: 14,
	display: 'flex',
	flexShrink: 0,
	height: 28,
	justifyContent: 'center',
	overflow: 'hidden',
	position: 'relative',
	width: 28
} as const

function skeletonRow<H, C, S>(host: H, ui: AuthUi<H, C, S>, id: string) {
	function bar(width: number | `${number}%`, height: number, borderRadius = 4) {
		return ui.view(
			host,
			{decorative: true, style: {backgroundColor: styles.control.backgroundColor, borderRadius, height, width}},
			[]
		)
	}
	return ui.view(host, {decorative: true, key: id, style: styles.row}, [
		bar(28, 28, 14),
		ui.view(host, {style: {...styles.lead, gap: 6}}, [bar('58%', 12), bar('36%', 10)]),
		bar(30, 8)
	])
}

// A row, a row-shaped skeleton or a notice, in the list or the detail.
export function entryView<H, C, S>(
	host: H,
	ui: AuthUi<H, C, S>,
	entry: Entry,
	reload: Kind<'directory'>['reload'],
	selection?: Omit<Selection, 'back'>
) {
	if (entry.kind === 'row') {
		return ui.row(host, {
			active: entry.row.item.id === selection?.id,
			cover: ui.cover(host, entry.row.mark),
			item: entry.row.item,
			...(selection !== undefined && {select: selection.select})
		})
	}
	if (entry.kind === 'skeleton') return skeletonRow(host, ui, entry.id)
	const target = entry.retry
	if (target === undefined) return ui.notice(host, entry.text)
	return ui.notice(host, entry.text, (element, event) => reload(element, event, target))
}

// The people beside the person: an admin's whole screen.
export function directory<H, C, S>(host: H, screen: Kind<'directory'>, ui: AuthUi<H, C, S>) {
	return workspace(host, ui, screen, {
		backLabel: 'Back to Auth',
		detail: Array.map(screen.detail, entry => entryView(host, ui, entry, screen.reload)),
		detailToolbar: screen.detailToolbar,
		list: (active, wide) => [
			...Array.map(screen.people, entry =>
				entryView(host, ui, entry, screen.reload, {id: active, select: screen.selection.select})
			),
			...Boolean.match(wide, {
				onFalse: () => Array.map(screen.accountNotes, entry => entryView(host, ui, entry, screen.reload)),
				onTrue: () => []
			})
		],
		toolbar: screen.toolbar
	})
}
