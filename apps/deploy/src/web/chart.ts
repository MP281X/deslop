import type {Html} from '@effect/ui/html'

import {Array, Option, String} from 'effect'
import type {DateTime} from 'effect'

import {historyTrace, levels, ruler, tracePaths} from '#screens/chart.ts'
import type {Reading} from '#screens/chart.ts'

export function Sparkline<M>(h: Html.H<M>, readings: readonly Reading[], now: DateTime.Utc) {
	return h.span.class('deploy-spark').children(Trace(h, readings, now))
}

function Trace<M>(h: Html.H<M>, readings: readonly Reading[], now: DateTime.Utc) {
	const paths = tracePaths(readings, now)
	return h
		.el('svg')
		.attrs({'aria-hidden': 'true', class: 'deploy-trace', preserveAspectRatio: 'none', viewBox: '0 0 100 100'})
		.children(
			h.el('path').attrs({class: 'deploy-area', d: paths.area}),
			h.el('path').attrs({class: 'deploy-line', d: paths.line, 'vector-effect': 'non-scaling-stroke'})
		)
}

export function History<M>(
	h: Html.H<M>,
	readings: readonly Reading[],
	restarts: readonly DateTime.Utc[],
	now: DateTime.Utc
) {
	const trace = historyTrace(readings, restarts, now)
	return h.figure.class('deploy-history').children(
		h.figcaption.class('deploy-caption').children('CPU · Past hour'),
		trace.point === undefined && Array.isArrayEmpty(trace.restarts)
			? h.p.class('deploy-caption').children('No CPU readings in the last hour')
			: h.div.class('deploy-axis').children(
					h.div.class('deploy-grid').children(
						Trace(h, readings, now),
						h.div
							.class('deploy-levels')
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
								.class('deploy-restart')
								.style({insetInlineStart: `${at}%`})
						),
						Option.getOrUndefined(
							Option.map(Option.fromUndefinedOr(trace.point), point =>
								h.span.class('deploy-point').style({insetInlineStart: `${point.left}%`, top: `${point.top}%`})
							)
						)
					),
					h.div
						.class('deploy-ruler')
						.attr('aria-hidden', 'true')
						.children(Array.map(ruler, label => h.span.key(label).children(label)))
				)
	)
}
