import {Array, Option, pipe} from 'effect'

import type {ScopeScreen} from '#app'
import type {ScopeUi} from '#view'

import {failureNotice} from '#operations/view.ts'

// The chosen trace: its summary and waterfall, with the details of the span in focus.
export function detailView<H, C, S>(host: H, screen: ScopeScreen, ui: ScopeUi<H, C, S>) {
	if (screen.detail.state === 'empty') return ui.note(host, screen.detail.text, false)
	if (screen.detail.state === 'loading') return ui.loading(host)
	if (screen.detail.state === 'problem') return failureNotice(host, screen, ui, screen.detail.failure)
	return ui.trace(host, {
		chart: Option.getOrUndefined(
			pipe(
				screen.detail.chart,
				Option.liftPredicate(chart => Array.isReadonlyArrayNonEmpty(chart.bars)),
				Option.map(chart => ui.chart(host, screen, chart))
			)
		),
		diagnostics: Option.getOrUndefined(Option.map(screen.detail.span, span => ui.diagnostics(host, screen, span))),
		started: Option.getOrUndefined(screen.detail.started),
		summary: ui.row(host, {
			active: false,
			item: {id: 'trace-summary', line: screen.detail.age, title: screen.detail.title, trailing: screen.detail.duration}
		})
	})
}
