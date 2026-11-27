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

export function waterfall(trace: TraceTree, focus: Option.Option<SpanId>, measured: number) {
	const width = Number.max(1, measured)
	const total = Number.max(Duration.toMillis(trace.durationMs), 1)
	function pixels(duration: Duration.Duration) {
		return (Duration.toMillis(duration) / total) * width
	}
	const spans = Record.fromIterableBy(trace.spans, span => span.spanId)

	function geometry(span: TraceSpan) {
		const bar = Number.clamp(pixels(span.durationMs), {maximum: width, minimum: Number.min(width, 2)})
		const left = Number.clamp(pixels(span.offsetMs), {maximum: width - bar, minimum: 0})
		const label = `${span.name} · ${durationOf(span.durationMs)}`
		const labelWidth = label.length * SCALE * 0.61
		const labelled = span.depth <= 1
		const inside = labelled && bar >= labelWidth + 12
		return {after: labelled && !inside && left + bar + labelWidth + 8 <= width, bar, inside, label, labelWidth, left}
	}

	// Leave enough room for a label next to a short job bar; steps pack into the rest of its lane.
	const marks = Array.map(
		lanesOf(
			trace.spans,
			Record.fromEntries(
				Array.flatMap(trace.spans, span => {
					const box = geometry(span)
					if (!box.after) return []
					return [[span.spanId, Duration.millis(((box.labelWidth + 8) / width) * total)] as const]
				})
			)
		),
		entry => {
			const box = geometry(entry.span)
			const parent = Option.flatMap(entry.span.parentSpanId, id => Record.get(spans, id))
			const failed = entry.span.status === 'failed'
			const suffix = Boolean.match(failed, {onFalse: Function.constant(''), onTrue: Function.constant(', failed')})
			return {
				after: box.after,
				bar: box.bar,
				description: `${Option.match(parent, {
					onNone: () => box.label,
					onSome: ancestor => `${ancestor.name} · ${box.label}`
				})} at ${durationOf(entry.span.offsetMs)}${suffix}`,
				failed,
				inside: box.inside,
				label: box.label,
				lane: entry.lane,
				left: box.left,
				right:
					box.left +
					box.bar +
					Boolean.match(box.after, {onFalse: Function.constant(0), onTrue: () => box.labelWidth + 8}),
				selected: Option.contains(focus, entry.span.spanId),
				span: entry.span
			}
		}
	)

	return {
		bars: pipe(
			marks,
			Array.zip(hitAreasOf(marks, width, 16)),
			Array.map(pair => ({...pair[0], hit: pair[1]}))
		),
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
