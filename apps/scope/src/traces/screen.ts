import type {DateTime} from 'effect'
import {
	Array,
	Boolean,
	Duration,
	Formatter,
	Function,
	Number,
	Option,
	Predicate,
	Record,
	Schema,
	String,
	pipe
} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import type {RowData, ToolbarAction} from '@deslop/components/model'
import {ageOf, clockOf, durationOf} from '@deslop/runtime/shared/format'

import type {Failure} from '#reads'

import {hitAreasOf, lanesOf} from './shared.ts'

import {problemDot} from '#operations/screen.ts'
import {appName} from '#telemetry/contract.ts'
import type {OperationTrace, SpanId, TraceId, TraceSpan, TraceTree} from '#telemetry/contract.ts'

// The HTTP attributes a failed span's error line already reads, so its details do not repeat them.
const HTTP_ATTRIBUTES = [
	'http.request.method',
	'http.response.status_code',
	'server.address',
	'server.port',
	'url.full',
	'url.path',
	'url.scheme'
] as const

const STATUS: Record<string, string> = {
	400: 'Bad Request',
	401: 'Unauthorized',
	403: 'Forbidden',
	404: 'Not Found',
	407: 'Proxy Authentication Required',
	409: 'Conflict',
	422: 'Unprocessable Entity',
	429: 'Too Many Requests',
	500: 'Server Error',
	502: 'Bad Gateway',
	503: 'Unavailable',
	504: 'Gateway Timeout'
}

type Wrapped = typeof Wrapped.Type
const Wrapped = Schema.Record(Schema.String, Schema.Json)

// A trace's name in a row or heading: the source's own number when it has one, else the id's short form.
function traceLabel(trace: OperationTrace) {
	return Option.getOrElse(trace.label, () => String.slice(0, 8)(trace.id))
}

// An attribute's one value as text; an array or map OTLP sent keeps its wrapping, such as {arrayValue: …}, shown as JSON.
function valueOf(value: Schema.Json) {
	if (Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)) return `${value}`
	return pipe(
		Schema.decodeUnknownOption(Wrapped)(value),
		Option.flatMap(wrapped => Array.head(Record.values(wrapped))),
		Option.filter(inner => Predicate.isString(inner) || Predicate.isNumber(inner) || Predicate.isBoolean(inner)),
		Option.match({onNone: () => Formatter.formatJson(value), onSome: inner => `${inner}`})
	)
}

// Omit service.name, trace.label and values equal to the span name; failed spans also omit HTTP attributes, and error.type is omitted when it repeats the HTTP status.
function attributesOf(span: TraceTree['spans'][number]) {
	const failing = span.status === 'failed'
	const attributes = pipe(
		Record.toEntries(span.attributes),
		Array.filter(entry => entry[0] !== 'service.name'),
		Array.map(entry => ({key: entry[0], value: valueOf(entry[1])}))
	)
	const status = Array.findFirst(attributes, attribute => attribute.key === 'http.response.status_code')
	return Array.filter(
		attributes,
		attribute =>
			attribute.value !== span.name &&
			attribute.key !== 'trace.label' &&
			!(failing && Array.contains(HTTP_ATTRIBUTES, attribute.key)) &&
			(attribute.key !== 'error.type' || !Option.exists(status, code => code.value === attribute.value))
	)
}

// The span the URL picks, else where the failure broke, else the first span.
function focusOf(trace: TraceTree, pickedSpan: Option.Option<SpanId>) {
	return pipe(
		trace.spans,
		Array.findFirst(span => Option.contains(pickedSpan, span.spanId)),
		Option.orElse(() =>
			pipe(
				trace.failureSpanId,
				Option.flatMap(id => Array.findFirst(trace.spans, span => span.spanId === id)),
				Option.orElse(() => Array.findFirst(trace.spans, span => span.depth === 0))
			)
		)
	)
}

function urlLabel(url: URL) {
	return `${url.host}${url.pathname}`
}

function httpUrl(value: string) {
	if (!URL.canParse(value)) return undefined
	const url = new URL(value)
	if (url.protocol === 'http:' || url.protocol === 'https:') return url
	return undefined
}

function errorOf(message: string, denied: boolean) {
	return pipe(
		message,
		String.match(/^StatusCode error \((\d{3}) (\w+) (https?:\/\/[^\s)]+)\)$/u),
		Option.match({
			onNone: () => ({
				message,
				title: Boolean.match(denied, {onFalse: Function.constant('Error'), onTrue: Function.constant('Denied')})
			}),
			onSome: parts => {
				const address = parts[3] ?? ''
				const label = pipe(
					httpUrl(address),
					Option.fromUndefinedOr,
					Option.map(urlLabel),
					Option.getOrElse(() => address)
				)
				return {
					message: `${parts[2]} ${label} · ${parts[1]}`,
					title: pipe(
						STATUS,
						Record.get(parts[1] ?? ''),
						Option.getOrElse(() => `HTTP ${parts[1]}`)
					)
				}
			}
		})
	)
}

function spanDetail(span: TraceSpan) {
	const failure = pipe(
		span.error,
		Option.orElse(() => span.exception),
		Option.map(message => errorOf(message, span.status === 'denied'))
	)
	const fields = Array.map(attributesOf(span), attribute => {
		if (attribute.key === 'url.full') {
			const url = httpUrl(attribute.value)
			if (url !== undefined) return {id: 'attribute:url.full', label: 'URL', url: url.href, value: urlLabel(url)}
		}
		return {id: `attribute:${attribute.key}`, label: attribute.key, url: undefined, value: attribute.value}
	})
	const line = `${appName(span.service)} · at ${durationOf(span.offsetMs)}`

	return {
		failure,
		fields,
		logs: Array.map(span.logs, log => ({
			failed: log.severity >= 17,
			id: `${log.id}`,
			text: log.message,
			time: clockOf(log.time, 'millisecond')
		})),
		row: {
			id: 'span',
			line,
			...Boolean.match(span.status === 'failed', {
				onFalse: () => ({}),
				onTrue: () => ({problem: {reason: line, status: 'error'}}) as const
			}),
			title: span.name,
			trailing: durationOf(span.durationMs)
		}
	}
}

export type SpanDetail = ReturnType<typeof spanDetail>

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

function waterfall(trace: TraceTree, focus: Option.Option<SpanId>, measured: number) {
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

export function traceRow(trace: OperationTrace, now: DateTime.Utc) {
	const reason = Option.map(trace.failure, failure => `Failed in ${failure.span}`)
	return {
		id: `trace:${trace.id}`,
		line: clockOf(trace.start, 'second'),
		...problemDot(Option.isSome(reason), Option.getOrElse(reason, Function.constant(''))),
		title: traceLabel(trace),
		trailing: `${ageOf(trace.start, now)} · ${durationOf(trace.duration)}`
	} satisfies RowData
}

// The traces menu of the detail's bar: each kept trace of the operation, with how long ago it ran and where it failed.
export function traceMenu(traces: readonly OperationTrace[], active: Option.Option<string>, now: DateTime.Utc) {
	if (!Array.isReadonlyArrayNonEmpty(traces)) return []
	return [
		{
			id: 'traces',
			label: 'Traces',
			menu: Array.map(traces, item => ({
				checked: Option.contains(active, `trace:${item.id}`),
				id: `trace:${item.id}`,
				label: `${traceLabel(item)} · ${ageOf(item.start, now)} · ${durationOf(item.duration)}${Option.match(
					item.failure,
					{onNone: Function.constant(''), onSome: failure => ` · Failed in ${failure.span}`}
				)}`
			})),
			symbol: 'chevron.down'
		} satisfies ToolbarAction
	]
}

export type Chart = ReturnType<typeof waterfall>

// What the detail shows: nothing chosen yet, the trace's read while it loads or fails, or the trace with the span in focus.
export function detailOf(options: {
	activeTrace: Option.Option<{id: TraceId; summary: Option.Option<OperationTrace>}>
	chartWidth: number
	failure: Option.Option<Failure>
	loading: boolean
	now: DateTime.Utc
	pickedSpan: Option.Option<SpanId>
	read: AsyncResult.AsyncResult<TraceTree, unknown>
}) {
	const active = Option.getOrUndefined(options.activeTrace)
	if (active === undefined) {
		if (options.loading) return {state: 'loading' as const}
		return {state: 'empty' as const, text: 'Select an operation'}
	}
	const failure = Option.getOrUndefined(options.failure)
	if (failure !== undefined) return {failure, state: 'problem' as const}
	const trace = Option.getOrUndefined(AsyncResult.value(options.read))
	if (trace === undefined) return {state: 'loading' as const}
	const root = Array.findFirst(trace.spans, span => span.depth === 0)
	const started = pipe(
		active.summary,
		Option.map(summary => summary.start),
		Option.orElse(() => Option.map(root, span => span.start))
	)
	const focus = focusOf(trace, options.pickedSpan)
	return {
		age: Option.match(started, {onNone: Function.constant(''), onSome: start => ageOf(start, options.now)}),
		chart: waterfall(
			trace,
			Option.map(focus, span => span.spanId),
			options.chartWidth
		),
		duration: durationOf(trace.durationMs),
		span: Option.map(focus, spanDetail),
		started: Option.map(started, start => clockOf(start, 'second')),
		state: 'ready' as const,
		title: Option.match(active.summary, {onNone: () => String.slice(0, 8)(active.id), onSome: traceLabel})
	}
}
