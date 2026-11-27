import {Mount} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Array, Boolean, Effect, Function, Option, Queue, Stream} from 'effect'

import {ListDetail, Row, selected, status, styles, webStyle} from '@deslop/design/web'

import {Message} from '#screens/model.ts'
import type {Screen} from '#screens/scope.ts'
import type {SpanDetail} from '#screens/span.ts'
import {BAR, LANE, SKELETON_BARS} from '#screens/waterfall.ts'

type H<M> = Html.H<M>
type Detail = Extract<Screen['detail'], {state: 'ready'}>

const WatchWidth = Mount.makeStream('Scope/ChartWidth', {args: {}}, (node: unknown) =>
	Stream.callback<ReturnType<typeof Message.Resize>>(out =>
		Effect.acquireRelease(
			Effect.sync(() => {
				if (!(node instanceof HTMLElement)) throw new TypeError('The waterfall needs an HTML element')
				const observer = new ResizeObserver(() => {
					Queue.offerUnsafe(out, Message.Resize({width: node.getBoundingClientRect().width}))
				})
				observer.observe(node)
				return observer
			}),
			observer => Effect.sync(() => observer.disconnect())
		)
	)
)

function Problem<M>(h: H<M>, screen: Screen, problem: NonNullable<Screen['problem']>) {
	return h.div
		.class('scope-notice')
		.children(
			h.p.attr('role', 'status').children(problem.text),
			problem.action === 'retry' && screen.retry(h.button, 'click').class('scope-control').children('Retry'),
			problem.action === 'sign-in' && screen.signIn(h.button, 'click').class('scope-control').children('Sign in')
		)
}

function Waterfall<M>(h: H<M>, screen: Screen, chart: Detail['chart']) {
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
			.watch(h.div, WatchWidth({}))
			.class('scope-lanes')
			.attrs({role: 'group', 'aria-label': 'Spans'})
			.style({height: `${chart.height}px`})
			.children(
				Array.map(chart.bars, bar =>
					screen
						.selectSpan(h.button, 'click', bar.span.spanId)
						.key(`${bar.span.traceId}:${bar.span.spanId}`)
						.class('scope-mark')
						.attrs({
							type: 'button',
							'aria-current': Boolean.match(bar.selected, {
								onFalse: Function.constUndefined,
								onTrue: Function.constant('true')
							}),
							'aria-label': bar.description,
							title: bar.description
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
			Row(h, {active: false, item: span.row}),
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
		.attrs({'aria-label': 'Loading trace', 'aria-busy': 'true', role: 'status'})
		.children(
			h.span.style({width: '32%'}),
			h.div
				.class('scope-lanes')
				.style({height: `${3 * LANE + BAR}px`})
				.children(
					Array.map(SKELETON_BARS, bar =>
						h.span
							.key(`${bar.top}:${bar.left}`)
							.style({...bar, top: `${bar.top}px`, position: 'absolute', height: `${BAR}px`})
					)
				),
			h.span.style({width: '48%'}),
			h.span.style({width: '25%'})
		)
}

function detail<M>(h: H<M>, screen: Screen) {
	const trace = screen.detail
	switch (trace.state) {
		case 'loading':
			return Skeleton(h)
		case 'problem':
			return Problem(h, screen, trace.problem)
		case 'empty':
			return h.p.class('scope-notice').children(trace.text)
		case 'ready':
			return h.div
				.class('scope-trace')
				.children(
					h.div
						.attr('title', Option.getOrUndefined(trace.started))
						.children(
							Row(h, {
								active: false,
								item: {id: 'trace-summary', title: trace.title, line: trace.age, trailing: trace.duration}
							})
						),
					Boolean.match(Array.isReadonlyArrayEmpty(trace.chart.bars), {
						onTrue: () => h.p.class('scope-notice').children('No spans'),
						onFalse: () =>
							h.div
								.class('scope-trace-body')
								.children(
									Waterfall(h, screen, trace.chart),
									Option.getOrUndefined(Option.map(trace.span, span => Diagnostics(h, span)))
								)
					})
				)
	}
}

export function Workspace<M>(h: H<M>, screen: Screen) {
	const empty = h.p.class('scope-notice').children('No operations')
	return ListDetail(h, {
		defaultId: screen.defaultId,
		detail: Boolean.match(screen.problem === undefined, {
			onFalse: Function.constUndefined,
			onTrue: () => detail(h, screen)
		}),
		detailToolbar: screen.detailToolbar,
		empty,
		list: (activeId, wide) => {
			if (screen.problem !== undefined) return Problem(h, screen, screen.problem)
			const operations = Array.map(screen.operations, row =>
				h.div
					.key(row.item.id)
					.attr(
						'title',
						Boolean.match(row.item.problem === undefined, {onFalse: () => row.hint, onTrue: () => row.item.title})
					)
					.children(Row(h, {active: row.item.id === activeId, item: row.item, select: screen.selection.select}))
			)
			if (Array.isReadonlyArrayEmpty(operations)) return empty
			const split = wide && Array.isReadonlyArrayNonEmpty(screen.traces)
			return h.div.class(split && 'scope-list-split').children(
				h.div.class('scope-operations').children(operations),
				split &&
					h.div.class('scope-traces').children(
						Array.map(screen.traces, item =>
							h.div
								.key(item.id)
								.attr('title', item.problem?.reason)
								.children(
									Row(h, {
										active: activeId !== undefined && item.id === screen.activeTrace,
										item,
										select: screen.selection.select
									})
								)
						)
					)
			)
		},
		loading: screen.loading,
		selection: screen.selection,
		toolbar: screen.toolbar
	})
}
