import type {Html} from '@effect/ui/html'

import type {DateTime} from 'effect'
import {Array, String} from 'effect'

import {axisPosition, restartPositions, tracePaths} from '#web/inventory/chart.ts'
import type {Reading} from '#web/inventory/chart.ts'

const LABELS = ['−60m', '−45m', '−30m', '−15m', 'Now']
const LEVELS = [100, 75, 50, 25, 0]

export function Ruler<M>(h: Html.H<M>) {
	return h.div
		.class('deploy-scale deploy-ruler')
		.attr('aria-hidden', 'true')
		.children(
			Array.map(LABELS, (label, index) =>
				h.span
					.key(label)
					.style({'--at': `${index * 25}%`})
					.children(label)
			)
		)
}

export function Trace<M>(h: Html.H<M>, readings: readonly Reading[], now: DateTime.Utc) {
	const paths = tracePaths(readings, now)
	return h
		.el('svg')
		.attrs({'aria-hidden': 'true', class: 'deploy-trace', preserveAspectRatio: 'none', viewBox: '0 0 100 100'})
		.children(
			h.el('path').attrs({class: 'deploy-area', d: paths.area}),
			h.el('path').attrs({class: 'deploy-trace-line', d: paths.line, 'vector-effect': 'non-scaling-stroke'})
		)
}

export function CpuScale<M>(h: Html.H<M>) {
	return h.div
		.class('deploy-scale deploy-cpu-scale')
		.attr('aria-hidden', 'true')
		.children(
			Array.map(LEVELS, (level, index) =>
				h.span
					.key(String.String(level))
					.style({'--at': `${index * 25}%`})
					.children(`${level}%`)
			)
		)
}

export function Restarts<M>(h: Html.H<M>, restarts: readonly DateTime.Utc[], now: DateTime.Utc) {
	return h.div
		.class('deploy-restarts')
		.attr('aria-hidden', 'true')
		.children(
			Array.map(restartPositions(restarts, now), (at, index) =>
				h.span.key(String.String(index)).style({'--at': `${at}%`})
			)
		)
}

export function RestartReason(restarts: readonly DateTime.Utc[], now: DateTime.Utc) {
	const recent = Array.filter(restarts, at => axisPosition(at, now) >= 100 - 100 / 6 && axisPosition(at, now) <= 100)
	if (Array.isArrayEmpty(recent)) return undefined
	if (recent.length === 1) return 'Restarted once in 10 min'
	return `Restarted ${recent.length} times in 10 min`
}
