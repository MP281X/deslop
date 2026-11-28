import './styles.css'

import {Mount, Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {BrowserHost, Html} from '@effect/ui/html'

import {Array, Boolean, Function, Layer, Option} from 'effect'

import type {PaneLeaf} from '@deslop/components/model'
import {Row, WatchLayout, selected, status, styles, webStyle} from '@deslop/components/web'
import {webComponents} from '@deslop/components/web/components'
import {mountPage} from '@deslop/components/web/page'
import {layerWebShell} from '@deslop/runtime/web/shell'

import {resized, scopeApp} from '#app'
import type {ScopeScreen} from '#app'
import {ScopeRoute, layerScope} from '#reads'
import {Workspace} from '#view'
import type {ScopeUi} from '#view'

import type {Chart, SpanDetail} from '#traces/screen.ts'
import {BAR, LANE, SKELETON_BARS} from '#traces/screen.ts'

type H<M> = Html.H<M>

function Waterfall<M>(h: H<M>, screen: ScopeScreen, chart: Chart) {
	return h.div.class('scope-waterfall').children(
		h.div
			.class('scope-axis')
			.attr('aria-hidden', 'true')
			.children(
				Array.map(chart.ticks, tick =>
					h.span
						.key(`${tick.ratio}`)
						.style({left: `${tick.ratio * 100}%`})
						.children(tick.label)
				)
			),
		screen
			.watch(
				h.div,
				Mount.map(WatchLayout({}), size => resized(size.width))
			)
			.class('scope-lanes')
			.attrs({'aria-label': 'Spans', role: 'group'})
			.style({height: `${chart.height}px`})
			.children(
				Array.map(chart.bars, bar =>
					screen
						.selectSpan(h.button, 'click', bar.span.spanId)
						.key(`${bar.span.traceId}:${bar.span.spanId}`)
						.class('scope-mark')
						.attrs({
							'aria-current': Boolean.match(bar.selected, {
								onFalse: Function.constUndefined,
								onTrue: Function.constant('true')
							}),
							'aria-label': bar.description,
							title: bar.description,
							type: 'button'
						})
						.style({left: `${bar.hit.left}px`, top: `${bar.lane * LANE}px`, width: `${bar.hit.width}px`})
						.children(
							h.span
								.class('scope-bar', bar.failed && 'scope-bar-failed')
								.attr('aria-hidden', 'true')
								.style({
									backgroundColor: Boolean.match(bar.failed, {
										onFalse: Function.constant(selected),
										onTrue: Function.constant(status.error)
									}),
									left: `${bar.left - bar.hit.left}px`,
									width: `${bar.bar}px`
								})
								.children(bar.inside && h.span.children(bar.label)),
							bar.after &&
								h.span
									.class('scope-after')
									.attr('aria-hidden', 'true')
									.style({left: `${bar.left - bar.hit.left + bar.bar + 4}px`})
									.children(bar.label)
						)
				)
			)
	)
}

function Diagnostics<M>(h: H<M>, span: SpanDetail) {
	return h.section
		.class('scope-diagnostics')
		.attr('aria-label', 'Span details')
		.children(
			Row<M, never>(h, {active: false, item: span.row}),
			Option.getOrUndefined(
				Option.map(span.failure, error =>
					h.div
						.class('scope-failure')
						.children(h.p.style(webStyle(styles.title)).children(error.title), h.p.children(error.message))
				)
			),
			h.dl.children(
				Array.map(span.fields, field =>
					h.div
						.key(field.id)
						.class('scope-field')
						.children(
							h.dt.children(field.label),
							h.dd.children(
								Option.match(Option.fromUndefinedOr(field.url), {
									onNone: () => field.value,
									onSome: href => h.a.attrs({href, rel: 'noreferrer', target: '_blank'}).children(field.value)
								})
							)
						)
				)
			),
			Array.isReadonlyArrayNonEmpty(span.logs) &&
				h.ol.attr('aria-label', 'Span logs').children(
					Array.map(span.logs, log =>
						h.li
							.key(log.id)
							.class('scope-log')
							.children(
								h.time.children(log.time),
								h.pre
									.style({
										color: Boolean.match(log.failed, {
											onFalse: Function.constUndefined,
											onTrue: Function.constant(status.error)
										})
									})
									.children(log.text)
							)
					)
				)
		)
}

function Skeleton<M>(h: H<M>) {
	return h.div
		.class('scope-trace-skeleton')
		.attrs({'aria-busy': 'true', 'aria-label': 'Loading trace', role: 'status'})
		.children(
			h.span.style({width: '32%'}),
			h.div
				.class('scope-lanes')
				.style({height: `${3 * LANE + BAR}px`})
				.children(
					Array.map(SKELETON_BARS, bar =>
						h.span
							.key(`${bar.top}:${bar.left}`)
							.style({...bar, height: `${BAR}px`, position: 'absolute', top: `${bar.top}px`})
					)
				),
			h.span.style({width: '48%'}),
			h.span.style({width: '25%'})
		)
}

const drawing: ScopeUi<Html.H<never>, PaneLeaf<View.Input<never>>, View.Content<never>> = {
	...webComponents<never>(),
	chart: Waterfall,
	diagnostics: (h, _screen, span) => Diagnostics(h, span),
	entry: (h, id, title, row) => h.div.key(id).attr('title', title).children(row),
	leaves: true,
	list: (h, options) => {
		const split = options.traces !== undefined
		return h.div
			.class(split && 'scope-list-split')
			.children(
				h.div.class('scope-operations').children(options.operations),
				split && h.div.class('scope-traces').children(options.traces)
			)
	},
	loading: Skeleton,
	note: (h, text) => h.p.class('scope-notice').children(text),
	problem: (h, text, action) =>
		h.div
			.class('scope-notice')
			.children(
				h.p.attr('role', 'status').children(text),
				Option.getOrUndefined(
					Option.map(Option.fromUndefinedOr(action), found =>
						found.press(h.button, 'click').class('scope-control').children(found.label)
					)
				)
			),
	trace: (h, options) =>
		h.div
			.class('scope-trace')
			.children(
				h.div.attr('title', options.started).children(options.summary),
				Option.match(Option.fromUndefinedOr(options.chart), {
					onNone: () => h.p.class('scope-notice').children('No spans'),
					onSome: chart => h.div.class('scope-trace-body').children(chart, options.diagnostics)
				})
			)
}

const App = scopeApp(false)(Html.vocabulary, (h, screen) => Workspace(h, screen, drawing))

// Scope does not trace itself.
mountPage(ScopeRoute, root =>
	Layer.provide(
		BrowserHost.mount(App, Router.props(ScopeRoute), root),
		Layer.provideMerge(layerScope, layerWebShell('scope', {telemetry: false}))
	)
)
