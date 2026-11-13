import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Formatter,
	Number,
	Option,
	Order,
	Predicate,
	Record,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import {liveAtom} from '@deslop/runtime/client/live-stream'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {layerPageProtocol} from '@deslop/runtime/web/client'

import {RpcContracts} from '#rpcs/contracts.ts'
import {AppName, Operation, Range, SpanId, TraceId} from '#services/telemetry/schema.ts'
import type {OperationTrace, Overview, TraceTree} from '#services/telemetry/schema.ts'

// The pane Back returns to; from Traces it is the operations, which the URL leaves unnamed.
const UP: Record<string, Pane> = {Span: 'Trace', Trace: 'Traces'}

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

type Pane = typeof Pane.Type
const Pane = Schema.Literals(['Traces', 'Trace', 'Span'])

type Wrapped = typeof Wrapped.Type
const Wrapped = Schema.Record(Schema.String, Schema.Json)

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/scope/lib/telemetry/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: layerPageProtocol
}) {}

export type OperationKey = typeof OperationKey.Type
const OperationKey = Schema.Struct({app: AppName, name: Operation.fields.name, runtime: Operation.fields.runtime})
type Selection = typeof Selection.Type
const Selection = Schema.Struct({
	operation: OperationKey,
	spanId: Schema.OptionFromOptionalKey(SpanId),
	traceId: Schema.OptionFromOptionalKey(TraceId)
})
export type NavigationEvent =
	| {readonly _tag: 'Back'}
	| {readonly _tag: 'Operation'; readonly operation: OperationKey}
	| {readonly _tag: 'Range'; readonly keepTrace: boolean; readonly range: Range}
	| {readonly _tag: 'Source'; readonly app: AppName}
	| {readonly _tag: 'Span'; readonly selection: {operation: OperationKey; spanId: SpanId; traceId: TraceId}}
	| {readonly _tag: 'Trace'; readonly selection: {operation: OperationKey; traceId: TraceId}}

export type Search = typeof Search.Type
export const Search = Schema.Struct({
	operation: Schema.OptionFromOptionalKey(Schema.String),
	pane: Schema.OptionFromOptionalKey(Pane),
	range: Schema.OptionFromOptionalKey(Range),
	side: Schema.OptionFromOptionalKey(Operation.fields.runtime),
	source: Schema.OptionFromOptionalKey(AppName),
	span: Schema.OptionFromOptionalKey(SpanId),
	trace: Schema.OptionFromOptionalKey(TraceId)
})

export function navigationOf(search: Search) {
	return {
		path: Option.getOrElse(search.pane, () => 'Operations' as const),
		selection: Option.map(
			Option.all({app: search.source, name: search.operation, runtime: search.side}),
			operation => ({operation, spanId: search.span, traceId: search.trace}) satisfies Selection
		)
	}
}

// The URL a selection produces in the given pane; a pick keeps the pane it was made in and the page's time frame.
function select(selection: Selection, frame: Option.Option<Range>, pane: Option.Option<Pane>) {
	return {
		operation: Option.some(selection.operation.name),
		pane,
		range: frame,
		side: Option.some(selection.operation.runtime),
		source: Option.some(selection.operation.app),
		span: selection.spanId,
		trace: selection.traceId
	} satisfies Search
}

// The bar chooses one app at a time and clears the selection it no longer contains; choosing the chosen app again changes nothing.
function sourceSearch(search: Search, app: AppName) {
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

export function nextSearch(search: Search, event: NavigationEvent) {
	if (event._tag === 'Source') return sourceSearch(search, event.app)
	if (event._tag === 'Operation') {
		return select(
			{operation: event.operation, spanId: Option.none(), traceId: Option.none()},
			search.range,
			Option.some('Traces')
		)
	}
	if (event._tag === 'Trace') {
		return select(
			{...event.selection, spanId: Option.none(), traceId: Option.some(event.selection.traceId)},
			search.range,
			Option.some('Trace')
		)
	}
	if (event._tag === 'Span') {
		return select(
			{...event.selection, spanId: Option.some(event.selection.spanId), traceId: Option.some(event.selection.traceId)},
			search.range,
			Option.some('Span')
		)
	}
	if (event._tag === 'Range') {
		const kept = Boolean.match(event.keepTrace, {
			onFalse: () => ({...search, span: Option.none(), trace: Option.none()}),
			onTrue: () => search
		})
		return {...kept, range: Option.some(event.range)} satisfies Search
	}
	return {...search, pane: Option.flatMap(search.pane, current => Record.get(UP, current))} satisfies Search
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

export const overviewAtom = Atom.family((range: Range) => Atom.keepAlive(liveAtom(RpcClient, 'telemetry.watch', range)))

const traceAtoms = Atom.family((id: TraceId) => liveAtom(RpcClient, 'telemetry.trace', {id}))

// An open trace follows arrivals, including late children and logs that do not change its duration.
export function traceAtom(id: TraceId) {
	return traceAtoms(id)
}

// The page's clock, so ages keep counting on a quiet page.
export const nowAtom = Atom.make(Stream.mapEffect(Stream.tick(Duration.seconds(30)), () => DateTime.now))

// A trace's name in a row or heading: the source's own number when it has one, else the id's short form.
export function traceLabel(trace: OperationTrace) {
	return Option.getOrElse(trace.label, () => String.slice(0, 8)(trace.id))
}

export function ageOf(start: DateTime.Utc, now: DateTime.Utc) {
	const seconds = Number.max(0, Duration.toSeconds(DateTime.distance(start, now)))
	if (seconds < 10) return 'now'
	if (seconds < 60) return `${Number.round(seconds, 0)}s`
	if (seconds < 3600) return `${Number.round(seconds / 60, 0)}m`
	if (seconds < 86_400) return `${Number.round(seconds / 3600, 0)}h`
	return `${Number.round(seconds / 86_400, 0)}d`
}

export function durationOf(duration: Duration.Duration) {
	const ms = Duration.toMillis(duration)
	// Each bound sits where rounding would reach the next unit, so 59.6 s reads 1 min, not 60 s.
	if (ms < 999.5) return `${Number.round(ms, 0)} ms`
	if (ms < 9950) return `${Number.round(ms / 1000, 1)} s`
	if (ms < 59_500) return `${Number.round(ms / 1000, 0)} s`
	if (ms < 3_570_000) return `${Number.round(ms / 60_000, 0)} min`
	return `${Number.round(ms / 3_600_000, 1)} h`
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

export function errorOf(span: TraceTree['spans'][number]) {
	return span.error
}

// Attributes, without anything that only repeats the row: its name, code.function, or the status code the error line carries.
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

// The app, operation, trace and span the URL selects; a desktop layout defaults to the app's first operation and phone starts empty.
export function selectionOf(overview: Option.Option<Overview>, search: Search, mobile: boolean) {
	const source = pipe(
		search.source,
		Option.filter(name => Option.exists(overview, current => Array.some(current.apps, app => app.name === name))),
		Option.orElse(() => Option.flatMap(overview, openingApp))
	)
	const selection = navigationOf(search).selection
	const activeOperation = pipe(
		Option.map(selection, selected => selected.operation),
		Option.flatMap(key => Option.flatMap(overview, current => findOperation(current, key))),
		Option.filter(active => Option.contains(source, active.app.name)),
		Option.orElse(() =>
			Boolean.match(mobile, {
				onFalse: () =>
					Option.flatMap(overview, current =>
						Option.map(Array.head(operationsOf(current, source)), row => ({app: row.app, operation: row.operation}))
					),
				onTrue: () => Option.none<ActiveOperation>()
			})
		)
	)
	const activeKey = Option.map(activeOperation, active => ({
		app: active.app.name,
		name: active.operation.name,
		runtime: active.operation.runtime
	}))
	const activeTrace = Option.flatMap(activeOperation, active =>
		pipe(
			Option.flatMap(selection, selected => selected.traceId),
			Option.flatMap(selected => Array.findFirst(active.operation.traces, trace => trace.id === selected)),
			Option.orElse(() => Array.head(active.operation.traces))
		)
	)
	const pickedSpan = pipe(
		selection,
		Option.filter(selected => Option.exists(activeTrace, trace => Option.contains(selected.traceId, trace.id))),
		Option.flatMap(selected => selected.spanId)
	)
	return {activeKey, activeOperation, activeTrace, pickedSpan, source}
}

// The URL as the page shows it: the chosen app and, once a frame's operations arrive, no operation or trace that frame no longer holds.
export function shownSearch(
	search: Search,
	selection: {
		activeOperation: Option.Option<ActiveOperation>
		activeTrace: Option.Option<OperationTrace>
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
	if (staleOperation) {
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
