import {Array, Boolean, Function} from 'effect'

import type {Components} from '@deslop/components/components'
import type {Absent, PaneLeaf, Press, ToolbarOptions} from '@deslop/components/model'

import type {OpmScreen} from '#app'

import type {ChapterRow} from '#chapters/screen.ts'
import {chapterList, toolbarOf} from '#chapters/view.ts'

// The pieces the hosts draw differently: the chapters' lists and covers, the reader's pages, the notices and how the panes sit in the page.
export type OpmUi<H, C, S> = Components<H, C, S> & {
	chapters: (
		host: H,
		screen: OpmScreen,
		options: {label: string; older: boolean},
		content: readonly PaneLeaf<C>[]
	) => PaneLeaf<C>
	cover: (host: H, screen: OpmScreen, row: ChapterRow) => PaneLeaf<C>
	// The actions of a problem: the way back, and the retry and sign-in the page draws as its own control and link.
	leave: (host: H, label: string, press: Press) => PaneLeaf<C>
	loading: (host: H) => readonly PaneLeaf<C>[]
	native: boolean
	note: (host: H, text: string) => PaneLeaf<C>
	problem: (host: H, text: string, actions: readonly PaneLeaf<C>[]) => PaneLeaf<C>
	retry: (host: H, label: string, press: Press) => PaneLeaf<C>
	reader: (host: H, screen: OpmScreen, reader: NonNullable<OpmScreen['reader']>) => PaneLeaf<C>
	signIn: (host: H, label: string, press: Press) => PaneLeaf<C>
	stage: (
		host: H,
		screen: OpmScreen,
		parts: {
			panes: {latest: PaneLeaf<C>; older: PaneLeaf<C> | Absent; reader: PaneLeaf<C> | Absent} | Absent
			problem: PaneLeaf<C> | Absent
			toolbar: ToolbarOptions
		}
	) => S
}

// The problem that takes the page's place: a sign-in or refusal the shell found, a route that is not one, or chapters that did not load.
function problemOf<H, C, S>(host: H, screen: OpmScreen, ui: OpmUi<H, C, S>) {
	if (screen.problem === undefined) {
		if (!screen.failed) return undefined
		return ui.problem(host, 'Couldn’t load chapters', [ui.retry(host, 'Retry', screen.retry)])
	}
	if (screen.problem.back) {
		return ui.problem(host, screen.problem.text, [ui.leave(host, 'Back to chapters', screen.selection.back)])
	}
	if (!screen.problem.signIn) return ui.problem(host, screen.problem.text, [])
	function text() {
		if (screen.problem?.signInFailed === true) return screen.problem.text
		if (screen.signOutProblem !== undefined) return screen.signOutProblem
		if (screen.signingIn) return 'Signing in…'
		return 'Sign in to read chapters'
	}
	return ui.problem(
		host,
		text(),
		Boolean.match(screen.signingIn, {
			onFalse: () => [ui.signIn(host, 'Sign in', screen.authenticate)],
			onTrue: () => Array.empty<PaneLeaf<C>>()
		})
	)
}

function readerOf<H, C, S>(host: H, screen: OpmScreen, ui: OpmUi<H, C, S>) {
	if (screen.reader === undefined) return undefined
	return ui.reader(host, screen, screen.reader)
}

function panesOf<H, C, S>(host: H, screen: OpmScreen, ui: OpmUi<H, C, S>) {
	return {
		latest: chapterList(host, screen, ui, false),
		older: Boolean.match(screen.book && screen.reader === undefined, {
			onFalse: Function.constUndefined,
			onTrue: () => chapterList(host, screen, ui, true)
		}),
		reader: readerOf(host, screen, ui)
	}
}

export function Workspace<H, C, S>(host: H, screen: OpmScreen, ui: OpmUi<H, C, S>) {
	const problem = problemOf(host, screen, ui)
	return ui.stage(host, screen, {
		panes: Boolean.match(problem === undefined, {
			onFalse: Function.constUndefined,
			onTrue: () => panesOf(host, screen, ui)
		}),
		problem,
		toolbar: {actions: toolbarOf(screen, ui.native), choose: screen.choose}
	})
}
