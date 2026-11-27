import {Array, Boolean, DateTime, Formatter, Option, Order, Predicate, Record, Schema, String, pipe} from 'effect'

import {AppName, Operation, Runtime} from '#contracts'
import type {OperationTrace, Overview, SpanId, TraceTree} from '#contracts'

import type {ScopeRoute} from '#screens/routes.ts'

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

type Wrapped = typeof Wrapped.Type
const Wrapped = Schema.Record(Schema.String, Schema.Json)

export type OperationKey = typeof OperationKey.Type
export const OperationKey = Schema.Struct({app: AppName, name: Operation.fields.name, runtime: Runtime})
export type Search = ScopeRoute['search']
export type Selection = {operation: OperationKey; spanId: Search['span']; traceId: Search['trace']}

function selectionIn(search: Search) {
	return Option.map(
		Option.all({app: search.source, name: search.operation, runtime: search.side}),
		operation => ({operation, spanId: search.span, traceId: search.trace}) satisfies Selection
	)
}

// The URL a selection produces in the given pane; a pick keeps the pane it was made in and the page's time frame.
export function select(search: Search, selection: Selection, pane: Option.Option.Value<Search['pane']>) {
	return {
		operation: Option.some(selection.operation.name),
		pane: Option.some(pane),
		range: search.range,
		side: Option.some(selection.operation.runtime),
		source: Option.some(selection.operation.app),
		span: selection.spanId,
		trace: selection.traceId
	} satisfies Search
}

// The bar chooses one app at a time and clears the selection it no longer contains; choosing the chosen app again changes nothing.
export function sourceSearch(search: Search, app: AppName) {
	if (Option.contains(search.source, app)) return search
	return {
		...search,
		operation: Option.none(),
		pane: Option.none(),
		side: Option.none(),
		source: Option.some(app),
		span: Option.none(),
		trace: Option.none()
	}
}

// The app a plain open lands on: the one whose newest failed trace is newest, else the first tab.
function openingApp(overview: Overview) {
	return pipe(
		Array.flatMap(overview.apps, app =>
			Array.flatMap(app.operations, operation =>
				Array.getSomes(
					Array.map(operation.traces, trace => Option.map(trace.failure, () => ({app: app.name, start: trace.start})))
				)
			)
		),
		Array.match({
			onEmpty: () => Option.none<{app: AppName; start: DateTime.Utc}>(),
			onNonEmpty: entries =>
				Option.some(
					Array.max(
						entries,
						Order.mapInput(DateTime.Order, entry => entry.start)
					)
				)
		}),
		Option.map(entry => entry.app),
		Option.orElse(() => Option.map(Array.head(overview.apps), app => app.name))
	)
}

// A trace's name in a row or heading: the source's own number when it has one, else the id's short form.
export function traceLabel(trace: OperationTrace) {
	return Option.getOrElse(trace.label, () => String.slice(0, 8)(trace.id))
}

export type ActiveOperation = {app: Overview['apps'][number]; operation: Operation}

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
export function attributesOf(span: TraceTree['spans'][number]) {
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

// One app's operations, in the overview's order: failing first, then most recently seen.
export function operationsOf(overview: Overview, source: Option.Option<AppName>) {
	return pipe(
		overview.apps,
		Array.filter((app: Overview['apps'][number]) => Option.contains(source, app.name)),
		Array.flatMap((app: Overview['apps'][number]) => Array.map(app.operations, operation => ({app, operation})))
	)
}

function findOperation(overview: Overview, key: OperationKey) {
	return pipe(
		overview.apps,
		Array.findFirst(app => app.name === key.app),
		Option.flatMap(app =>
			pipe(
				app.operations,
				Array.findFirst(operation => operation.runtime === key.runtime && operation.name === key.name),
				Option.map(operation => ({app, operation}))
			)
		)
	)
}

// The span the URL picks, else where the failure broke, else the first span.
export function focusOf(trace: TraceTree, pickedSpan: Option.Option<SpanId>) {
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

// A quiet frame is not a missing trace: retain explicit URL ids for the detail reader; defaults apply only without a trace id.
export function selectionOf(overview: Option.Option<Overview>, search: Search) {
	const selection = selectionIn(search)
	const requested = Option.flatMap(selection, selected => selected.traceId)
	const source = pipe(
		search.source,
		Option.filter(
			name =>
				Option.isSome(requested) ||
				Option.exists(overview, current => Array.some(current.apps, app => app.name === name))
		),
		Option.orElse(() => Option.flatMap(overview, openingApp))
	)
	const activeOperation = pipe(
		Option.map(selection, selected => selected.operation),
		Option.flatMap(key => Option.flatMap(overview, current => findOperation(current, key))),
		Option.filter(active => Option.contains(source, active.app.name)),
		Option.orElse(() =>
			Boolean.match(Option.isSome(requested), {
				onFalse: () => Option.flatMap(overview, current => Array.head(operationsOf(current, source))),
				onTrue: () => Option.none<ActiveOperation>()
			})
		)
	)
	const activeKey = pipe(
		activeOperation,
		Option.map(active => ({app: active.app.name, name: active.operation.name, runtime: active.operation.runtime})),
		Option.orElse(() =>
			pipe(
				selection,
				Option.filter(selected => Option.isSome(selected.traceId)),
				Option.map(selected => selected.operation)
			)
		)
	)
	const listed = Option.flatMap(activeOperation, active =>
		Option.match(requested, {
			onNone: () => Array.head(active.operation.traces),
			onSome: id => Array.findFirst(active.operation.traces, trace => trace.id === id)
		})
	)
	const activeTrace = pipe(
		requested,
		Option.orElse(() => Option.map(listed, trace => trace.id)),
		Option.map(id => ({id, summary: listed}))
	)
	const pickedSpan = pipe(
		selection,
		Option.filter(selected => Option.exists(activeTrace, trace => Option.contains(selected.traceId, trace.id))),
		Option.flatMap(selected => selected.spanId)
	)
	return {activeKey, activeOperation, activeTrace, pickedSpan, source}
}

// Without a direct trace, drop vanished operation selections; explicit trace URLs keep their ids and context.
export function shownSearch(
	search: Search,
	selection: {
		activeOperation: Option.Option<ActiveOperation>
		activeTrace: Option.Option<Pick<OperationTrace, 'id'>>
		source: Option.Option<AppName>
	},
	loaded: boolean
) {
	const chosen = Option.match(selection.source, {onNone: () => search, onSome: app => sourceSearch(search, app)})
	if (!loaded) return chosen
	const staleOperation =
		Option.isSome(chosen.operation) &&
		!Option.exists(
			selection.activeOperation,
			active =>
				Option.contains(chosen.source, active.app.name) &&
				Option.contains(chosen.operation, active.operation.name) &&
				Option.contains(chosen.side, active.operation.runtime)
		)
	if (staleOperation && Option.isNone(chosen.trace)) {
		return {...chosen, operation: Option.none(), side: Option.none(), span: Option.none(), trace: Option.none()}
	}
	if (
		Option.isSome(chosen.trace) &&
		!Option.exists(selection.activeTrace, trace => Option.contains(chosen.trace, trace.id))
	) {
		return {...chosen, span: Option.none(), trace: Option.none()}
	}
	return chosen
}
