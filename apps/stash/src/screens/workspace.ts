import type {View} from '@effect/ui'

import {Array, Option, pipe} from 'effect'

import type {RowOptions} from '@deslop/design/model'

import type {Reader, StashMessage, StashScreen} from '#screens/notes.ts'

export type WorkspaceChild = Exclude<View.Content<StashMessage>, View.Text>

export type WorkspaceViews<H> = {
	list: (h: H, rows: readonly WorkspaceChild[], notice?: WorkspaceChild) => WorkspaceChild
	notice: (h: H, text: string, retryable?: boolean) => WorkspaceChild
	reader: (h: H, screen: StashScreen, note: Reader) => WorkspaceChild
	row: (h: H, options: RowOptions<never>) => WorkspaceChild
	skeleton: (h: H) => WorkspaceChild
}

function detail<H>(h: H, screen: StashScreen, views: WorkspaceViews<H>) {
	if (screen.detailLoading) return views.skeleton(h)
	if (screen.detailFailed) return views.notice(h, 'Couldn’t load the note', true)
	if (screen.detailMissing) return views.notice(h, 'Note not found')
	if (screen.detail === undefined) return undefined
	return views.reader(h, screen, screen.detail)
}

export function workspace<H>(h: H, screen: StashScreen, views: WorkspaceViews<H>) {
	const queueMessage = pipe(
		Option.fromUndefinedOr(screen.queueMessage),
		Option.map(text => views.notice(h, text, screen.queueRetryable)),
		Option.getOrUndefined
	)
	return {
		...pipe(
			Option.fromUndefinedOr(screen.detail),
			Option.map(note => ({defaultId: note.id})),
			Option.getOrElse(() => ({}))
		),
		detail: detail(h, screen, views),
		detailToolbar: screen.toolbar.detail,
		empty: queueMessage,
		list: (activeId: StashScreen['selection']['id']) =>
			views.list(
				h,
				Array.map(screen.list.rows, item =>
					views.row(h, {active: activeId === item.id, item, select: screen.selection.select})
				),
				queueMessage
			),
		loading: screen.list.loading,
		selection: screen.selection,
		sheet: {dismiss: screen.dismiss, label: 'New note', open: screen.composing, pending: screen.pending},
		toolbar: screen.toolbar.queue
	}
}
