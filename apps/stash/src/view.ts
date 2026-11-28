import {Array, Option, pipe} from 'effect'

import type {Components} from '@deslop/components/components'
import type {Absent, ListOptions, PaneLeaf, ToolbarOptions} from '@deslop/components/model'

import type {Reader, StashScreen} from '#app'

// The pieces the hosts draw differently: the screen in place of the notes, the tag filters, the note and its notices, and the sheet that writes one.
export type StashUi<H, C, S> = Components<H, C, S> & {
	header: (host: H, screen: StashScreen) => C | Absent
	leave: (host: H, screen: StashScreen) => S
	list: (host: H, rows: readonly PaneLeaf<C>[], note: PaneLeaf<C> | Absent) => PaneLeaf<C>
	loadingNote: (host: H) => PaneLeaf<C>
	note: (host: H, screen: StashScreen, text: string, retryable: boolean) => PaneLeaf<C>
	reader: (host: H, screen: StashScreen, note: Reader) => PaneLeaf<C>
	retry: (host: H, screen: StashScreen, message: string) => S
	sheet: (host: H, screen: StashScreen) => {body: C; height?: number; toolbar?: ToolbarOptions}
	signIn: (host: H, screen: StashScreen, message: string) => S
	stage: (host: H, screen: StashScreen, options: ListOptions<C>) => S
}

// What takes the notes' place: the way back from a page that is not one, a sign-in, a refusal or an outage.
function gateOf<H, C, S>(host: H, screen: StashScreen, ui: StashUi<H, C, S>) {
	if (screen.problem === undefined) {
		if (!screen.failed) return undefined
		return ui.retry(host, screen, 'Couldn’t connect to Stash')
	}
	if (screen.problem.back) return ui.leave(host, screen)
	if (screen.problem.signIn) return ui.signIn(host, screen, screen.problem.text)
	return ui.retry(host, screen, screen.problem.text)
}

function detailOf<H, C, S>(host: H, screen: StashScreen, ui: StashUi<H, C, S>) {
	if (screen.detailLoading) return ui.loadingNote(host)
	if (screen.detailFailed) return ui.note(host, screen, 'Couldn’t load the note', true)
	if (screen.detailMissing) return ui.note(host, screen, 'Note not found', false)
	if (screen.detail === undefined) return undefined
	return ui.reader(host, screen, screen.detail)
}

export function Workspace<H, C, S>(host: H, screen: StashScreen, ui: StashUi<H, C, S>) {
	const gate = gateOf(host, screen, ui)
	if (gate !== undefined) return gate
	const queueNote = pipe(
		Option.fromUndefinedOr(screen.queueMessage),
		Option.map(text => ui.note(host, screen, text, screen.queueRetryable)),
		Option.getOrUndefined
	)
	return ui.stage(host, screen, {
		...pipe(
			Option.fromUndefinedOr(screen.detail),
			Option.map(note => ({defaultId: note.id})),
			Option.getOrElse(() => ({}))
		),
		detail: detailOf(host, screen, ui),
		detailToolbar: screen.detailActions,
		empty: queueNote,
		header: ui.header(host, screen),
		list: activeId =>
			ui.list(
				host,
				Array.map(screen.list.rows, item =>
					ui.row(host, {active: activeId === item.id, item, select: screen.selection.select})
				),
				queueNote
			),
		loading: screen.list.loading,
		selection: screen.selection,
		sheet: {
			dismiss: screen.dismiss,
			label: 'New note',
			open: screen.composing,
			pending: screen.pending,
			...ui.sheet(host, screen)
		},
		toolbar: {actions: screen.queueActions, choose: screen.choose}
	})
}
