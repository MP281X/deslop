import {Array, Option} from 'effect'

import type {Components} from '@deslop/components/components'
import type {Absent, PaneContent, PaneLeaf, Press} from '@deslop/components/model'

import type {ScopeScreen} from '#app'

import {failureNotice, listRows} from '#operations/view.ts'
import type {Chart, SpanDetail} from '#traces/screen.ts'
import {detailView} from '#traces/view.ts'

// The pieces the hosts draw differently: the notices and their buttons, the waterfall and a span's details, and how the list and a trace sit in their panes.
export type ScopeUi<H, C, S> = Components<H, C, S> & {
	chart: (host: H, screen: ScopeScreen, chart: Chart) => PaneLeaf<C>
	diagnostics: (host: H, screen: ScopeScreen, span: SpanDetail) => PaneLeaf<C>
	entry: (host: H, id: string, title: string | Absent, row: C) => PaneLeaf<C>
	// Whether the page leaves for Auth by itself, so a sign-in the server asks for reads as under way.
	leaves: boolean
	list: (
		host: H,
		options: {operations: readonly PaneLeaf<C>[]; traces: readonly PaneLeaf<C>[] | Absent}
	) => PaneContent<PaneLeaf<C>>
	loading: (host: H) => PaneLeaf<C>
	note: (host: H, text: string, listed: boolean) => PaneLeaf<C>
	problem: (host: H, text: string, action?: {label: string; press: Press}) => PaneLeaf<C>
	trace: (
		host: H,
		options: {
			chart: PaneLeaf<C> | Absent
			diagnostics: PaneLeaf<C> | Absent
			started: string | Absent
			summary: PaneLeaf<C>
		}
	) => PaneLeaf<C>
}

export function Workspace<H, C, S>(host: H, screen: ScopeScreen, ui: ScopeUi<H, C, S>) {
	const empty = ui.note(host, 'No operations', true)
	return ui.listDetail(host, {
		defaultId: screen.defaultId,
		...Option.match(screen.failure, {onNone: () => ({detail: detailView(host, screen, ui)}), onSome: () => ({})}),
		detailToolbar: screen.detailToolbar,
		empty,
		list: (activeId, wide) => {
			const failure = Option.getOrUndefined(screen.failure)
			if (failure !== undefined) return failureNotice(host, screen, ui, failure)
			const operations = listRows(host, screen, ui, activeId)
			if (Array.isReadonlyArrayEmpty(operations.operations)) return empty
			return ui.list(host, {
				operations: operations.operations,
				traces: Option.getOrUndefined(
					Option.liftPredicate(operations.traces, rows => wide && Array.isReadonlyArrayNonEmpty(rows))
				)
			})
		},
		loading: screen.loading,
		selection: screen.selection,
		toolbar: screen.toolbar
	})
}
