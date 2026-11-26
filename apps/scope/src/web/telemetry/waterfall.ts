import type {Html} from '@effect/ui/html'

import {Array, Boolean, Duration, Function, Number, Option, Record, pipe} from 'effect'

import {durationOf} from '@deslop/runtime/shared/format'
import {Button} from '@deslop/ui/control'

import type {SpanId, TraceSpan, TraceTree} from '#contracts'

import {Message} from '#web/telemetry/model.ts'

const TICKS = [0, 0.25, 0.5, 0.75, 1] as const

function TimeAxis(h: Html.H<Message>, total: Duration.Duration) {
	return h.div
		.class('scope-waterfall-grid scope-axis')
		.attr('aria-hidden', 'true')
		.children(
			h.div.class('scope-timeline').children(
				Array.map(TICKS, tick =>
					h.span
						.key(`${tick}`)
						.class('scope-tick')
						.style({left: `${tick * 100}%`})
						.children(
							Boolean.match(tick === 0, {
								onFalse: () => durationOf(Duration.millis(Duration.toMillis(total) * tick)),
								onTrue: Function.constant('0')
							})
						)
				)
			)
		)
}

function spanRow(
	h: Html.H<Message>,
	span: TraceSpan,
	spans: Record<SpanId, TraceSpan>,
	focus: Option.Option<SpanId>,
	total: number
) {
	const left = Number.clamp(Duration.toMillis(span.offsetMs) / total, {maximum: 1, minimum: 0})
	const width = Number.clamp(Duration.toMillis(span.durationMs) / total, {maximum: 1 - left, minimum: 0})
	const duration = durationOf(span.durationMs)
	const location = pipe(
		span.parentSpanId,
		Option.flatMap(id => Record.get(spans, id)),
		Option.match({onNone: () => span.name, onSome: parent => `${parent.name} · ${span.name}`})
	)
	const description = `${location}${Boolean.match(span.status === 'failed', {
		onFalse: Function.constant(''),
		onTrue: Function.constant(', failed')
	})} · ${duration} at ${durationOf(span.offsetMs)}`
	return Button(h)
		.key(`${span.traceId}:${span.spanId}`)
		.class('axis-row scope-waterfall-grid scope-span')
		.attr('aria-current', `${Option.contains(focus, span.spanId)}`)
		.attr('aria-label', description)
		.attr('title', description)
		.on('click', Message.Span({id: span.spanId}))
		.children(
			h.span.class('scope-span-name').children(span.name),
			h.span
				.class('scope-timeline', 'scope-track')
				.attr('aria-hidden', 'true')
				.children(
					h.span
						.class('scope-bar', span.status === 'failed' && 'scope-bar-failed')
						.style({'--span-start': `${left * 100}%`, '--span-width': `${width * 100}%`})
				),
			h.span.class('axis-value').children(duration)
		)
}

export function Waterfall(h: Html.H<Message>, trace: TraceTree, focus: Option.Option<SpanId>) {
	const total = Number.max(Duration.toMillis(trace.durationMs), 1)
	const spans = Record.fromIterableBy(trace.spans, span => span.spanId)
	return h.div
		.class('scope-waterfall')
		.attr('role', 'group')
		.attr('aria-label', 'Spans')
		.children(
			TimeAxis(h, trace.durationMs),
			Array.map(trace.spans, span => spanRow(h, span, spans, focus, total))
		)
}
