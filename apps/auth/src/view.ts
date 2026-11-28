import {Array, Schema} from 'effect'

import type {Components} from '@deslop/components/components'
import type {PaneLeaf, Press, Selection, ToolbarOptions} from '@deslop/components/model'

import type {AuthScreen} from '#app'

import {accessScreen, notFound} from '#identity/view.ts'
import type {Mark} from '#people/screen.ts'
import {directory, entryView} from '#people/view.ts'

export type LineRole = typeof LineRole.Type
const LineRole = Schema.Literals(['alert', 'status'])

export type Kind<K extends AuthScreen['kind']> = Extract<AuthScreen, {kind: K}>

// The pieces the hosts draw differently: the mark beside a row, the lines of a status screen, the sign-in button and a member's list.
export type AuthUi<H, C, S> = Components<H, C, S> & {
	cover: (host: H, mark: Mark) => PaneLeaf<C>
	line: (host: H, text: string, role: LineRole) => PaneLeaf<C>
	memberList: (host: H, options: {rows: readonly C[]; selection: Selection; toolbar: ToolbarOptions}) => S
	signIn: (host: H, options: {disabled: boolean; label: string; press: Press}) => PaneLeaf<C>
}

export function Workspace<H, C, S>(host: H, screen: AuthScreen, ui: AuthUi<H, C, S>) {
	if (screen.kind === 'not-found') return notFound(host, screen, ui)
	if (screen.kind === 'access') return accessScreen(host, screen, ui)
	if (screen.kind === 'sessions') {
		// A member's whole screen: their own browser sessions.
		return ui.memberList(host, {
			rows: Array.map(screen.detail, entry => entryView(host, ui, entry, screen.reload)),
			selection: screen.selection,
			toolbar: screen.toolbar
		})
	}
	return directory(host, screen, ui)
}
