import type {Html} from '@effect/ui/html'

import {Array, Boolean, Option, String} from 'effect'
import type {DateTime} from 'effect'

import {historyTrace, levels, ruler, tracePaths} from '#src/shared/chart.ts'
import type {Reading} from '#src/shared/chart.ts'
import type {HistoryOptions} from '#src/shared/components.ts'

function Trace<M>(h: Html.H<M>, readings: readonly Reading[], now: DateTime.Utc) {
	const paths = tracePaths(readings, now)
	return h
		.el('svg')
		.attrs({'aria-hidden': 'true', class: 'design-trace', preserveAspectRatio: 'none', viewBox: '0 0 100 100'})
		.children(
			h.el('path').attrs({class: 'design-area', d: paths.area}),
			h.el('path').attrs({class: 'design-line', d: paths.line, 'vector-effect': 'non-scaling-stroke'})
		)
}

export function Sparkline<M>(h: Html.H<M>, readings: readonly Reading[], now: DateTime.Utc) {
	return h.span.class('design-spark').children(Trace(h, readings, now))
}

export function History<M>(h: Html.H<M>, options: HistoryOptions) {
	const trace = historyTrace(options.readings, options.restarts, options.now)
	return h.figure.class('design-history').children(
		h.figcaption.class('design-caption').children(options.title),
		Boolean.match(trace.point === undefined && Array.isArrayEmpty(trace.restarts), {
			onFalse: () =>
				h.div.class('design-axis').children(
					h.div.class('design-grid').children(
						Trace(h, options.readings, options.now),
						h.div
							.class('design-levels')
							.attr('aria-hidden', 'true')
							.children(
								Array.map(levels, (level, index) =>
									h.span
										.key(String.String(level))
										.style({'--at': `${index * 25}%`})
										.children(`${level}%`)
								)
							),
						Array.map(trace.restarts, (at, index) =>
							h.span
								.key(String.String(index))
								.class('design-restart')
								.style({insetInlineStart: `${at}%`})
						),
						Option.getOrUndefined(
							Option.map(Option.fromUndefinedOr(trace.point), point =>
								h.span.class('design-point').style({insetInlineStart: `${point.left}%`, top: `${point.top}%`})
							)
						)
					),
					h.div
						.class('design-ruler')
						.attr('aria-hidden', 'true')
						.children(Array.map(ruler, label => h.span.key(label).children(label)))
				),
			onTrue: () => h.p.class('design-caption').children(options.empty)
		})
	)
}
