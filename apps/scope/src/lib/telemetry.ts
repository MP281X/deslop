import {
	Array,
	Boolean,
	Clock,
	Effect,
	Formatter,
	Number,
	Option,
	Order,
	Predicate,
	Record,
	Schema,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import {keepValueThroughOutages, liveAtom, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {layerPageProtocol} from '@deslop/runtime/web/client'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Operation, Range} from '#services/telemetry/schema.ts'
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
const OperationKey = Schema.Struct({app: Schema.String, name: Operation.fields.name, runtime: Operation.fields.runtime})
type Selection = typeof Selection.Type
const Selection = Schema.Struct({
	operation: OperationKey,
	spanId: Schema.optionalKey(Schema.String),
	traceId: Schema.optionalKey(Schema.String)
})
export type NavigationEvent =
	| {readonly _tag: 'Back'}
	| {readonly _tag: 'Operation'; readonly operation: OperationKey}
	| {readonly _tag: 'Range'; readonly keepTrace: boolean; readonly range: Range}
	| {readonly _tag: 'Source'; readonly app: string}
	| {readonly _tag: 'Span'; readonly selection: {operation: OperationKey; spanId: string; traceId: string}}
	| {readonly _tag: 'Trace'; readonly selection: {operation: OperationKey; traceId: string}}

export type Search = typeof Search.Type
export const Search = Schema.Struct({
	operation: Schema.optionalKey(Schema.String),
	pane: Schema.optionalKey(Pane),
	range: Schema.optionalKey(Range),
	side: Schema.optionalKey(Operation.fields.runtime),
	source: Schema.optionalKey(Schema.String),
	span: Schema.optionalKey(Schema.String),
	trace: Schema.optionalKey(Schema.String)
})

export function navigationOf(search: Search) {
	return {
		path: search.pane ?? 'Operations',
		selection: Option.getOrUndefined(
			Option.map(
				Option.fromUndefinedOr(search.side),
				runtime =>
					({
						operation: {app: search.source ?? '', name: search.operation ?? '', runtime},
						...Option.match(Option.fromUndefinedOr(search.trace), {
							onNone: () => ({}),
							onSome: traceIdValue => ({traceId: traceIdValue})
						}),
						...Option.match(Option.fromUndefinedOr(search.span), {
							onNone: () => ({}),
							onSome: spanIdValue => ({spanId: spanIdValue})
						})
					}) satisfies Selection
			)
		)
	}
}

// The URL a selection produces in the given pane; a pick keeps the pane it was made in and the page's time frame.
function select(selection: Selection, frame?: Range, pane?: Pane) {
	return {
		operation: selection.operation.name,
		...Option.match(Option.fromUndefinedOr(frame), {onNone: () => ({}), onSome: rangeValue => ({range: rangeValue})}),
		side: selection.operation.runtime,
		source: selection.operation.app,
		...Option.match(Option.fromUndefinedOr(pane), {onNone: () => ({}), onSome: current => ({pane: current})}),
		...Option.match(Option.fromUndefinedOr(selection.traceId), {
			onNone: () => ({}),
			onSome: traceValue => ({trace: traceValue})
		}),
		...Option.match(Option.fromUndefinedOr(selection.spanId), {
			onNone: () => ({}),
			onSome: spanValue => ({span: spanValue})
		})
	} satisfies Search
}

// The bar chooses one app at a time and clears the selection it no longer contains; choosing the chosen app again changes nothing.
function sourceSearch(search: Search, app: string) {
	if (search.source === app) return search
	return {...Struct.omit(search, ['operation', 'pane', 'side', 'span', 'trace']), source: app}
}

// oxlint-disable-next-line @deslop/coding-standards/no-return-type -- Router callbacks return the whole Search contract, not a union narrowed to whichever keys a branch retains.
export function nextSearch(search: Search, event: NavigationEvent): Search {
	if (event._tag === 'Source') return sourceSearch(search, event.app)
	if (event._tag === 'Operation') return select({operation: event.operation}, search.range, 'Traces')
	if (event._tag === 'Trace') return select(event.selection, search.range, 'Trace')
	if (event._tag === 'Span') return select(event.selection, search.range, 'Span')
	if (event._tag === 'Range') {
		const kept = Boolean.match(event.keepTrace, {
			onFalse: () => Struct.omit(search, ['span', 'trace']),
			onTrue: () => search
		})
		return {...kept, range: event.range} satisfies Search
	}
	return pipe(
		Option.fromUndefinedOr(search.pane),
		Option.flatMap(current => Record.get(UP, current)),
		pipelineSubject4881 =>
			Option.match(pipelineSubject4881, {
				onNone: () => Struct.omit(search, ['pane']),
				onSome: up => ({...search, pane: up})
			})
	) satisfies Search
}

// The app a plain open lands on: the one whose newest failed trace is newest, else the first tab.
function openingApp(overview: Overview) {
	return pipe(
		Array.flatMap(overview.apps, app =>
			Array.flatMap(app.operations, operation =>
				Array.getSomes(
					Array.map(operation.traces, trace =>
						Option.map(Option.fromUndefinedOr(trace.failure), () => ({app: app.name, start: trace.start}))
					)
				)
			)
		),
		pipelineSubject5582 =>
			Array.match(pipelineSubject5582, {
				onEmpty: () => Option.none<{app: string; start: number}>(),
				onNonEmpty: entries =>
					Option.some(
						Array.max(
							entries,
							Order.mapInput(Order.Number, entry => entry.start)
						)
					)
			}),
		Option.map(entry => entry.app),
		Option.orElse(() => Option.map(Array.head(overview.apps), app => app.name))
	)
}

export const overviewAtom = Atom.family((range: Range) => Atom.keepAlive(liveAtom(RpcClient, 'telemetry.watch', range)))

const traceAtoms = Atom.family((range: Range) =>
	Atom.family((_id: string) =>
		RpcClient.runtime.atom(get => {
			get(overviewAtom(range))
			return keepValueThroughOutages(
				get,
				Stream.fromEffect(Effect.flatMap(RpcClient, client => client('telemetry.trace', {id: _id}))),
				reconnectOnDrop
			)
		})
	)
)

// An open trace follows arrivals, including late children and logs that do not change its duration.
export function traceAtom(range: Range, id: string) {
	return traceAtoms(range)(id)
}

// The page's clock, so ages keep counting on a quiet page.
export const nowAtom = Atom.make(Stream.mapEffect(Stream.tick('30 seconds'), () => Clock.currentTimeMillis))

// A trace's name in a row or heading: the source's own number when it has one, else the id's short form.
export function traceLabel(trace: OperationTrace) {
	return trace.label ?? String.slice(0, 8)(trace.id)
}

export function ageOf(start: number, now: number) {
	const seconds = Number.max(0, (now - start) / 1000)
	if (seconds < 10) return 'now'
	if (seconds < 60) return `${Number.round(seconds, 0)}s`
	if (seconds < 3600) return `${Number.round(seconds / 60, 0)}m`
	if (seconds < 86_400) return `${Number.round(seconds / 3600, 0)}h`
	return `${Number.round(seconds / 86_400, 0)}d`
}

export function durationOf(ms: number) {
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
export function operationsOf(overview: Overview, source?: string) {
	return pipe(
		overview.apps,
		Array.filter((app: Overview['apps'][number]) => app.name === source),
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
export function focusOf(trace: TraceTree, pickedSpan?: string) {
	return pipe(
		trace.spans,
		Array.findFirst(span => span.spanId === pickedSpan),
		Option.orElse(() =>
			pipe(
				Option.fromUndefinedOr(trace.failureSpanId),
				Option.flatMap(id => Array.findFirst(trace.spans, span => span.spanId === id)),
				Option.orElse(() => Array.findFirst(trace.spans, span => span.depth === 0))
			)
		)
	)
}

// The app, operation, trace and span the URL selects; a desktop layout defaults to the app's first operation and phone starts empty.
export function selectionOf(overview: Option.Option<Overview>, search: Search, mobile: boolean) {
	const source = Option.getOrUndefined(
		pipe(
			Option.fromUndefinedOr(search.source),
			Option.filter(name => Option.exists(overview, current => Array.some(current.apps, app => app.name === name))),
			Option.orElse(() => Option.flatMap(overview, openingApp))
		)
	)
	const selection = navigationOf(search).selection
	const activeOperation = pipe(
		Option.fromUndefinedOr(selection?.operation),
		Option.flatMap(key => Option.flatMap(overview, current => findOperation(current, key))),
		Option.filter(active => active.app.name === source),
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
			Option.fromUndefinedOr(selection?.traceId),
			Option.flatMap(selected => Array.findFirst(active.operation.traces, trace => trace.id === selected)),
			Option.orElse(() => Array.head(active.operation.traces))
		)
	)
	const pickedSpan = Option.getOrUndefined(
		pipe(
			Option.fromUndefinedOr(selection),
			Option.filter(selected => Option.exists(activeTrace, trace => selected.traceId === trace.id)),
			Option.flatMap(selected => Option.fromUndefinedOr(selected.spanId))
		)
	)
	return {
		activeKey,
		activeOperation,
		activeTrace,
		...Option.match(Option.fromUndefinedOr(pickedSpan), {
			onNone: () => ({}),
			onSome: pickedSpanValue => ({pickedSpan: pickedSpanValue})
		}),
		...Option.match(Option.fromUndefinedOr(source), {
			onNone: () => ({}),
			onSome: sourceValue => ({source: sourceValue})
		})
	}
}

// The URL as the page shows it: the chosen app and, once a frame's operations arrive, no operation or trace that frame no longer holds.
export function shownSearch(
	search: Search,
	selection: {
		activeOperation: Option.Option<ActiveOperation>
		activeTrace: Option.Option<OperationTrace>
		source?: string
	},
	loaded: boolean
) {
	const chosen = Option.match(Option.fromUndefinedOr(selection.source), {
		onNone: () => search,
		onSome: app => sourceSearch(search, app)
	})
	if (!loaded) return chosen
	const staleOperation =
		chosen.operation !== undefined &&
		!Option.exists(
			selection.activeOperation,
			active =>
				active.app.name === (chosen.source ?? '') &&
				active.operation.name === chosen.operation &&
				active.operation.runtime === chosen.side
		)
	if (staleOperation) return Struct.omit(chosen, ['operation', 'side', 'span', 'trace'])
	if (chosen.trace !== undefined && !Option.exists(selection.activeTrace, trace => trace.id === chosen.trace)) {
		return Struct.omit(chosen, ['span', 'trace'])
	}
	return chosen
}
