import {Array, Boolean, Duration, Function, Number, Option, Record, pipe} from 'effect'

import {durationOf} from '@deslop/runtime/shared/format'

import type {SpanId, TraceSpan, TraceTree} from '#contracts'

import {hitAreasOf, lanesOf} from '#screens/lanes.ts'

export const LANE = 24
export const BAR = 22
export const SCALE = 12
export const SKELETON_BARS = [
	{left: '0%', top: 0, width: '100%'},
	{left: '2%', top: LANE, width: '97%'},
	{left: '6%', top: 2 * LANE, width: '3%'},
	{left: '10%', top: 2 * LANE, width: '89%'},
	{left: '14%', top: 3 * LANE, width: '85%'}
] as const

function labelOf(span: TraceSpan) {
	return `${span.name} · ${durationOf(span.durationMs)}`
}

export function waterfall(trace: TraceTree, focus: Option.Option<SpanId>, measured: number) {
	const width = Number.max(1, measured)
	const total = Number.max(Duration.toMillis(trace.durationMs), 1)
	const durations = (duration: Duration.Duration) => (Duration.toMillis(duration) / total) * width
	const spans = Record.fromIterableBy(trace.spans, span => span.spanId)

	function geometry(span: TraceSpan) {
		const bar = Number.clamp(durations(span.durationMs), {maximum: width, minimum: Number.min(width, 2)})
		const left = Number.clamp(durations(span.offsetMs), {maximum: width - bar, minimum: 0})
		const label = labelOf(span)
		const labelWidth = label.length * SCALE * 0.61
		const labelled = span.depth <= 1
		const inside = labelled && bar >= labelWidth + 12
		const after = labelled && !inside && left + bar + labelWidth + 8 <= width
		return {after, bar, inside, label, labelWidth, left}
	}

	// Leave enough room for a label next to a short job bar; steps pack into the rest of its lane.
	const reservations = Record.fromEntries(
		Array.flatMap(trace.spans, span => {
			const {after, labelWidth} = geometry(span)
			if (!after) return []
			return [[span.spanId, Duration.millis(((labelWidth + 8) / width) * total)] as const]
		})
	)
	const placed = lanesOf(trace.spans, reservations)
	const marks = Array.map(placed, ({lane, span}) => {
		const {after, bar, inside, label, labelWidth, left} = geometry(span)
		const end = left + bar + Boolean.match(after, {onFalse: () => 0, onTrue: () => labelWidth + 8})
		const parent = pipe(
			span.parentSpanId,
			Option.flatMap(id => Record.get(spans, id))
		)
		const failed = span.status === 'failed'
		const suffix = Boolean.match(failed, {onFalse: () => '', onTrue: () => ', failed'})
		const description = `${Option.match(parent, {onNone: () => label, onSome: entry => `${entry.name} · ${label}`})} at ${durationOf(span.offsetMs)}${suffix}`
		return {
			after,
			bar,
			description,
			failed,
			inside,
			label,
			lane,
			left,
			right: end,
			span,
			selected: Option.contains(focus, span.spanId)
		}
	})
	const hits = hitAreasOf(marks, width, 16)
	return {
		bars: Array.map(Array.zip(marks, hits), ([mark, hit]) => ({...mark, hit})),
		height: Array.reduce(marks, 0, (height, mark) => Number.max(height, mark.lane * LANE + BAR)),
		ticks: Array.map([0, 0.25, 0.5, 0.75, 1], ratio => ({
			label: Boolean.match(ratio === 0, {
				onFalse: () => durationOf(Duration.millis(total * ratio)),
				onTrue: Function.constant('0')
			}),
			ratio
		}))
	}
}
