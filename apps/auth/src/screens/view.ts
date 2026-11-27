import {Array, Boolean, Function, Schema} from 'effect'

import type {Selection} from '@deslop/design/model'

import {visibleToolbar} from '#screens/directory.ts'
import type {Entry, Notice, Screen} from '#screens/directory.ts'
import {AuthRoute} from '#screens/routes.ts'
import type {AuthRow} from '#screens/rows.ts'

export const authApp = {
	definition: {message: Schema.Never, model: Schema.Null, name: 'Auth', props: Schema.Struct({route: AuthRoute})},
	lifecycle: {init: Function.constNull, update: Function.constNull}
}

export type RowSelection = Omit<Selection, 'back'>

export function rowOptions<A>(row: AuthRow, cover: A, selection?: RowSelection) {
	return {
		active: row.item.id === selection?.id,
		cover,
		item: row.item,
		...(selection !== undefined && {select: selection.select})
	}
}

export function renderEntry<A, B, C>(
	entry: Entry,
	render: {notice: (notice: Notice) => A; row: (row: AuthRow) => B; skeleton: (id: string) => C}
) {
	if (entry.kind === 'row') return render.row(entry.row)
	if (entry.kind === 'skeleton') return render.skeleton(entry.id)
	return render.notice(entry)
}

export function directoryOptions<A>(
	screen: Extract<Screen, {kind: 'directory'}>,
	render: (entry: Entry, retry: Screen['retry'], selection?: RowSelection) => A
) {
	return {
		defaultId: screen.defaultId,
		detail: Array.map(screen.detail, entry => render(entry, screen.retry)),
		detailToolbar: screen.detailToolbar,
		list: (active: Selection['id'], wide: boolean) => [
			...Array.map(screen.people, entry => render(entry, screen.retry, {id: active, select: screen.selection.select})),
			...Boolean.match(wide, {
				onFalse: () => Array.map(screen.accountNotes, entry => render(entry, screen.retry)),
				onTrue: () => []
			})
		],
		selection: screen.selection,
		toolbar: screen.toolbar
	}
}

export type Access = Extract<Screen, {kind: 'access'}>

export function accessOptions<Child, Content>(
	screen: Access,
	render: {
		content: (children: readonly Child[]) => Content
		entry: (entry: Entry, retry: Screen['retry']) => Child
		error: (error: string) => Child
		signIn: (part: Access['signIn'], label: string, disabled: boolean) => Child
		waiting: (text: string) => Child
	}
) {
	return {
		content: render.content([
			...Array.filter(
				[
					screen.state === 'waiting' && render.waiting('Waiting for an admin'),
					screen.state === 'sign-in' && render.signIn(screen.signIn, 'Continue with GitHub', screen.signingIn),
					screen.error !== undefined && render.error(screen.error)
				],
				(child): child is Child => child !== false
			),
			...Array.map(screen.entries, entry => render.entry(entry, screen.retry))
		]),
		toolbar: visibleToolbar(screen.toolbar)
	}
}
