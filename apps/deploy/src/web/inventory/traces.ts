import type {Html} from '@effect/ui/html'

import {Array, Boolean, DateTime, Function, String, pipe} from 'effect'
import type {Option} from 'effect'

import {axisPosition, restartPositions, tracePaths} from '#web/inventory/chart.ts'
import type {Reading} from '#web/inventory/chart.ts'

const LABELS = ['−60', '−45', '−30', '−15', 'now']
const LEVELS = [100, 75, 50, 25]

function tickHeight(index: number) {
	if (index % 15 === 0) return 0
	if (index % 5 === 0) return 5
	return 8
}

export function Ruler<M>(h: Html.H<M>, detail = false) {
	return h.div
		.class('deploy-ruler', detail && 'deploy-ruler-detail')
		.attr('aria-hidden', 'true')
		.children(
			Array.map(LABELS, (label, index) =>
				h.span
					.key(label)
					.style({'--at': `${index * 25}%`})
					.children(label)
			),
			h
				.el('svg')
				.attrs({preserveAspectRatio: 'none', viewBox: '0 0 60 12'})
				.children(
					h.el('path').attrs({
						d: pipe(
							61,
							Array.makeBy(index => `M${index} 12V${tickHeight(index)}`),
							Array.join('')
						),
						'vector-effect': 'non-scaling-stroke'
					})
				)
		)
}

export function Trace<M>(h: Html.H<M>, readings: readonly Reading[], now: DateTime.Utc, detail = false) {
	const paths = tracePaths(readings, now)
	return h
		.el('svg')
		.attrs({
			'aria-hidden': 'true',
			class: Boolean.match(detail, {
				onFalse: Function.constant('deploy-trace'),
				onTrue: Function.constant('deploy-trace deploy-trace-main')
			}),
			preserveAspectRatio: 'none',
			viewBox: '0 0 100 100'
		})
		.children(
			h.el('path').attrs({class: 'deploy-area', d: paths.area}),
			h.el('path').attrs({class: 'deploy-trace-line', d: paths.line, 'vector-effect': 'non-scaling-stroke'})
		)
}

export function CpuScale<M>(h: Html.H<M>) {
	return h.div
		.class('deploy-cpu-scale')
		.attr('aria-hidden', 'true')
		.children(
			Array.map(LEVELS, (level, index) =>
				h.span
					.key(String.String(level))
					.style({'--at': `${index * 25}%`})
					.children(String.String(level))
			)
		)
}

export function Restarts<M>(h: Html.H<M>, restarts: readonly DateTime.Utc[], now: DateTime.Utc, dots = false) {
	return h.div
		.class('deploy-restarts', dots && 'deploy-restarts-dots')
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

export type ProcessPoint = {time: DateTime.Utc; cpu: Option.Option<number>}

export function processReadings(samples: readonly ProcessPoint[]) {
	return Array.map(samples, (sample, index) => {
		const at = DateTime.toEpochMillis(sample.time)
		const since = Boolean.match(index === 0, {
			onFalse: () => DateTime.toEpochMillis(samples[index - 1]?.time ?? sample.time),
			onTrue: () => at - 5000
		})
		return {
			from: DateTime.makeUnsafe(Boolean.match(at - since <= 8000, {onFalse: () => at - 5000, onTrue: () => since})),
			time: sample.time,
			value: sample.cpu
		} satisfies Reading
	})
}
