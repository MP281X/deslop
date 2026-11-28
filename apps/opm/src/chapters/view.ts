import {Array, Boolean, Function} from 'effect'

import type {ToolbarAction} from '@deslop/components/model'

import type {OpmScreen} from '#app'
import type {OpmUi} from '#view'

// The toolbar: the reader's page turns and list, the series menu, and what the iPhone draws beside it.
export function toolbarOf(screen: OpmScreen, native: boolean): readonly ToolbarAction[] {
	const menu = Array.map(screen.seriesChoices, choice => ({
		checked: choice.checked,
		id: choice.series,
		label: choice.title
	}))
	return Array.filter(
		[
			screen.reader !== undefined && {id: 'back', label: 'Back', symbol: 'chevron.left'},
			screen.reader !== undefined &&
				screen.wide && {
					id: 'sidebar',
					label: Boolean.match(screen.listHidden, {
						onFalse: Function.constant('Hide list'),
						onTrue: Function.constant('Show list')
					}),
					symbol: 'sidebar.left'
				},
			screen.next && {id: 'next-page', label: 'Next page', symbol: 'chevron.left'},
			screen.previous && {id: 'previous-page', label: 'Previous page', symbol: 'chevron.right'},
			{
				id: 'series',
				label: 'Series',
				menu: Boolean.match(!native && screen.signOut, {
					onFalse: () => menu,
					onTrue: () => [...menu, {disabled: screen.busy, id: 'sign-out', label: 'Sign out'}]
				}),
				symbol: 'books.vertical'
			},
			screen.stale && {id: 'retry', label: 'Out of date. Retry', symbol: 'exclamationmark.circle'},
			native &&
				screen.signOut && {
					disabled: screen.busy,
					id: 'sign-out',
					label: 'Sign out',
					symbol: 'rectangle.portrait.and.arrow.right'
				}
		] satisfies readonly (ToolbarAction | boolean)[],
		action => action !== false
	)
}

// One list of chapters: its rows while they are known, else the skeleton or a note.
export function chapterList<H, C, S>(host: H, screen: OpmScreen, ui: OpmUi<H, C, S>, older: boolean) {
	const chapters = Boolean.match(older, {onFalse: () => screen.latest, onTrue: () => screen.older})
	function content() {
		if (screen.waiting) return ui.loading(host)
		if (chapters.empty) return [ui.note(host, 'No chapters')]
		return Array.map(chapters.rows, row =>
			ui.row(host, {
				active: row.active,
				cover: ui.cover(host, screen, row),
				item: row.data,
				muted: row.muted,
				select: screen.selection.select
			})
		)
	}
	return ui.chapters(host, screen, {label: chapters.label, older}, content())
}
