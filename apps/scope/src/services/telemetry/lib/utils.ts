import {
	Array,
	Boolean,
	Clock,
	DateTime,
	Effect,
	Formatter,
	Function,
	HashMap,
	HashSet,
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

import * as WebRuntime from '@deslop/runtime/web'

import {Attributes, Wrapped} from '#lib/schema.ts'
import type {OperationKey, Pane, Search, Selection} from '#lib/schema.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {Attribute, Nano, rangeStart, Runtime, Side} from '#services/telemetry/schema.ts'
import type {
	Entry,
	Operation,
	OperationTrace,
	Overview,
	Range,
	Resource,
	ServiceStatus,
	Trace
} from '#services/telemetry/schema.ts'

// Each operation lists this many traces, its newest failures among them.
const KEEP = 20

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

// Releases compare part by part as numbers, so 0.1.1235 is newer than 0.1.999.
const byRelease = Order.mapInput(Order.Array(Order.Number), (version: string) =>
	Array.map(String.split(version, '.'), part => Option.getOrElse(Number.parse(part), () => 0))
)

function resourceString(resource: {readonly attributes?: readonly Attribute[]}, key: string) {
	return pipe(
		resource.attributes ?? [],
		Array.findFirst(attribute => attribute.key === key),
		Option.flatMap(attribute => Option.liftPredicate(attribute.value['stringValue'], String.isString)),
		Option.getOrElse(() => '')
	)
}

function spanAttributes(payload: Schema.JsonObject) {
	return Option.getOrElse(Schema.decodeUnknownOption(Schema.Array(Attribute))(payload['attributes']), () => [])
}

// An OTLP attribute's one primitive value: a string, number or boolean, wrapped as the protocol sends it.
function primitiveOf(value: Schema.Json) {
	if (Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)) return value
	if (value === null || !Predicate.isObject(value) || Array.isArray(value)) return undefined
	const integer = value['intValue']
	if (Predicate.isNumber(integer)) return integer
	if (Predicate.isString(integer)) {
		return Option.getOrUndefined(Number.parse(integer))
	}
	const double = value['doubleValue']
	if (Predicate.isNumber(double)) return double
	const bool = value['boolValue']
	if (Predicate.isBoolean(bool)) return bool
	const string = value['stringValue']
	if (Predicate.isString(string)) return string
	return undefined
}

function attributePrimitive(attributes: readonly Attribute[], key: string) {
	return pipe(
		attributes,
		Array.findFirst(attribute => attribute.key === key),
		Option.flatMap(attribute => Option.fromUndefinedOr(primitiveOf(attribute.value)))
	)
}

// Effect names an HTTP span by its method alone: its route, or a client's path, says which request it was; unrouted server hits, mostly scanners, share one name. A machine step is named for its source.
export function spanName(span: Schema.JsonObject) {
	const name = Option.getOrElse(Option.liftPredicate(span['name'], String.isString), () => '')
	if (name === '') return name
	const attributes = spanAttributes(span)
	if (name === 'Machine.invoke') {
		const source = resourceString({attributes}, 'machine.invoke.source')
		if (String.isNonEmpty(source)) return `Machine.invoke ${source}`
	}
	if (name !== resourceString({attributes}, 'http.request.method')) return name
	const route = resourceString({attributes}, 'http.route')
	if (String.isNonEmpty(route)) return `${name} ${route}`
	// OTLP's SpanKind 2 is a server answering a request.
	if (span['kind'] === 2) return `${name} (no route)`
	return pipe(
		Option.liftPredicate(resourceString({attributes}, 'url.path'), String.isNonEmpty),
		Option.match({onNone: () => name, onSome: path => `${name} ${path}`})
	)
}

function versionOf(entry: Entry) {
	return resourceString(entry.resource, 'service.version')
}

// A version Scope can order, numbers joined by dots such as "0.1.1235"; OTel leaves `service.version` free text, so "1.2.0-rc.1" or a commit hash is never older than anything.
function releaseOf(entry: Entry) {
	return Option.getOrElse(
		Option.liftPredicate(versionOf(entry), version => Option.isSome(String.match(/^\d+(?:\.\d+)*$/u)(version))),
		() => ''
	)
}

export function newestVersions(entries: readonly Entry[], known: Record<string, string>) {
	const versioned = Array.filter(
		Array.map(entries, entry => ({service: entry.service, version: releaseOf(entry)})),
		item => item.version !== ''
	)
	return Record.union(
		known,
		Record.map(
			Array.groupBy(versioned, item => item.service),
			group =>
				Array.max(
					Array.map(group, item => item.version),
					byRelease
				)
		),
		Order.max(byRelease)
	)
}

function isSuperseded(entry: Entry, newest: Record<string, string>) {
	const version = releaseOf(entry)
	return (
		version !== '' &&
		Option.exists(Record.get(newest, entry.service), latest => Order.isLessThan(byRelease)(version, latest))
	)
}

// A trace is one request or action: when any of its entries is superseded or expires, its siblings go too, so a release never leaves one half on each side.
function tracePruned(entries: readonly Entry[], prune: (entry: Entry) => boolean) {
	return HashSet.fromIterable(
		Array.map(
			Array.filter(entries, entry => entry.traceId !== '' && prune(entry)),
			entry => entry.traceId
		)
	)
}

function pruned(entry: Entry, traces: HashSet.HashSet<string>, prune: (entry: Entry) => boolean) {
	if (entry.traceId === '') return prune(entry)
	return HashSet.has(traces, entry.traceId)
}

export function retentionOf(
	current: HashMap.HashMap<string, Entry>,
	newest: Record<string, string>,
	receivedAt: number,
	retentionMs: number
) {
	const now = BigInt(receivedAt) * 1_000_000n
	const cutoff = now - BigInt(retentionMs) * 1_000_000n
	const entries = Array.fromIterable(HashMap.values(current))
	const repaired = Array.map(
		Array.filter(entries, entry => entry.receivedAt === undefined && BigInt(entry.time) > now),
		entry => ({...entry, receivedAt})
	)
	function expiredOne(entry: Entry) {
		const received = Option.match(Option.fromUndefinedOr(entry.receivedAt), {
			onNone: () => BigInt(entry.time),
			onSome: time => BigInt(time) * 1_000_000n
		})
		return received < cutoff || isSuperseded(entry, newest)
	}
	const traces = tracePruned(entries, expiredOne)
	const expired = Array.filter(entries, entry => pruned(entry, traces, expiredOne))
	return {
		expired,
		next: Array.reduce(
			expired,
			Array.reduce(repaired, current, (all, entry) => HashMap.set(all, entry.id, entry)),
			(all, entry) => HashMap.remove(all, entry.id)
		),
		repaired
	}
}

export function reconcileReleases(
	current: HashMap.HashMap<string, Entry>,
	entries: Entry[],
	known: Record<string, string>
) {
	const newest = newestVersions(entries, known)
	const stored = Array.fromIterable(HashMap.values(current))
	const traces = tracePruned([...stored, ...entries], entry => isSuperseded(entry, newest))
	const accepted = Array.filter(entries, entry => !pruned(entry, traces, candidate => isSuperseded(candidate, newest)))
	const replaced = Array.filter(stored, entry => pruned(entry, traces, candidate => isSuperseded(candidate, newest)))
	return {
		accepted,
		newest,
		next: Array.reduce(
			accepted,
			Array.reduce(replaced, current, (all, entry) => HashMap.remove(all, entry.id)),
			(all, entry) => HashMap.set(all, entry.id, entry)
		),
		replaced
	}
}

export function appName(service: string) {
	return pipe(service, String.replace(/^@deslop\//u, ''), String.replace(/-(?:server|client|ios)$/u, ''))
}

function runtime(resource: Resource) {
	const value = resourceString(resource, 'scope.runtime')
	if (Schema.is(Runtime)(value)) return value
	return 'unknown' as const
}

// The tool's side: the resource's runtime, else the suffix its service name already carries; unknown names omit it.
export function sideFor(service: string, value: Runtime) {
	if (Schema.is(Side)(value)) return value
	if (String.endsWith('-server')(service)) return 'server' as const
	if (String.endsWith('-client')(service)) return 'web' as const
	if (String.endsWith('-ios')(service)) return 'mobile' as const
	return undefined
}

export function sideOf(service: string, resource: Resource) {
	return sideFor(service, runtime(resource))
}

function started(resource: Resource) {
	const value = resourceString(resource, 'scope.run.started_unix_nano')
	if (Schema.is(Nano)(value)) return BigInt(value)
	return 0n
}

// Each entry's run, read once per query: finding the marker searches the resource's attributes.
function runsOf(entries: Entry[]) {
	const runs = Record.fromEntries(Array.map(entries, entry => [entry.id, started(entry.resource)] as const))
	return (entry: Entry) => runs[entry.id] ?? 0n
}

export function serviceName(resource: Resource) {
	const value = resourceString(resource, 'service.name')
	if (String.isNonEmpty(value)) return value
	return 'unknown'
}

// The words and numbers of an OTLP value, keys included: `Effect.log('saved', note)` sends an array of its arguments.
function leaves(value: Schema.Json): string[] {
	if (Array.isArray<Schema.Json>(value)) return Array.flatMap(value, leaves)
	if (String.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)) return [`${value}`]
	if (value === null) return []
	return Array.flatMap(Record.values(value), leaves)
}

export function logMessage(body: Schema.JsonObject) {
	return Array.join(leaves(body), ' ')
}

export function durationMs(start: string, end: string) {
	if (BigInt(end) < BigInt(start)) return 0
	return pipe(Number.parse(`${BigInt(end) - BigInt(start)}`), Option.getOrThrow) / 1_000_000
}

function percentile(times: readonly number[], ratio: number) {
	return Option.getOrElse(Array.get(times, Number.max(0, Math.ceil(times.length * ratio) - 1)), () => 0)
}

// A failed span whose only failures are a denied sign-in is not a failure: no count, dot or error filter includes it.
export function failed(entry: Pick<Entry, 'denied' | 'status'>) {
	return entry.status === 2 && entry.denied !== true
}

// A failed span is denied when every exception event is an AuthError, or its HTTP response is 401 or 403.
export function deniedSpan(span: Schema.JsonObject) {
	const status = span['status']
	if (!Predicate.isObject(status) || status['code'] !== 2) return false
	const code = Option.getOrUndefined(attributePrimitive(spanAttributes(span), 'http.response.status_code'))
	if (code === 401 || code === 403) return true
	const events = Option.getOrElse(
		Schema.decodeUnknownOption(Schema.Array(Schema.JsonObject))(span['events']),
		() => [] as const
	)
	return Array.match(
		Array.filter(events, event => event['name'] === 'exception'),
		{
			onEmpty: () => false,
			onNonEmpty: exceptions =>
				Array.every(
					exceptions,
					event => resourceString({attributes: spanAttributes(event)}, 'exception.type') === 'AuthError'
				)
		}
	)
}

// The diagnostic a span is remembered by: an exception's message or the status line, first line only, no stack trace.
export function failureMessage(payload: Schema.JsonObject) {
	const events = Option.getOrElse(
		Schema.decodeUnknownOption(Schema.Array(Schema.JsonObject))(payload['events']),
		() => [] as const
	)
	const status = Option.liftPredicate(payload['status'], Predicate.isObject)
	const message = Option.orElse(
		pipe(
			Array.findFirst(events, event => event['name'] === 'exception'),
			Option.flatMap(event => attributePrimitive(spanAttributes(event), 'exception.message')),
			Option.filter(Predicate.isString),
			Option.filter(String.isNonEmpty)
		),
		() =>
			Option.flatMap(status, value =>
				Option.liftPredicate(
					value['message'],
					(item): item is string => Predicate.isString(item) && String.isNonEmpty(item)
				)
			)
	)
	return pipe(
		Option.getOrElse(message, () => ''),
		value => Array.head(String.split(value, '\n')),
		Option.getOrElse(() => ''),
		String.trim,
		String.slice(0, 300)
	)
}

// One flat object of primitive attribute values, without keys that only repeat the span or carry no diagnosis.
export function attributesFlat(payload: Schema.JsonObject, name: string, failedSpan: boolean) {
	const entries = Array.flatMap(spanAttributes(payload), attribute => {
		const value = primitiveOf(attribute.value)
		if (value === undefined) return []
		if (
			attribute.key === 'service.name' ||
			attribute.key === 'rpc.system.name' ||
			attribute.key === 'url.scheme' ||
			attribute.key === 'server.port'
		) {
			return []
		}
		if (String.startsWith('code.')(attribute.key)) return []
		if (attribute.key === 'rpc.method' && value === name) return []
		if (attribute.key === 'user_agent.original' && !failedSpan) return []
		if (value === name) return []
		return [[attribute.key, value] as const]
	})
	if (Array.isReadonlyArrayEmpty(entries)) return undefined
	return Record.fromEntries(entries)
}

export function isoTime(nano: string) {
	return DateTime.formatIso(DateTime.makeUnsafe(Option.getOrThrow(Number.parse(`${BigInt(nano) / 1_000_000n}`))))
}

export function isoMillis(milliseconds: number) {
	return DateTime.formatIso(DateTime.makeUnsafe(milliseconds))
}

export function rounded(ms: number) {
	return Number.round(ms, 1)
}

function severityOf(entry: Pick<Entry, 'payload'>) {
	if (Predicate.isNumber(entry.payload['severityNumber'])) return entry.payload['severityNumber']
	const text = pipe(
		Option.liftPredicate(entry.payload['severityText'], String.isString),
		Option.getOrElse(() => ''),
		String.toUpperCase
	)
	if (text === 'FATAL' || text === 'ERROR') return 17
	if (text === 'WARN') return 13
	if (text === 'INFO') return 9
	if (text === 'DEBUG') return 5
	return 0
}

export function levelOf(entry: Pick<Entry, 'payload'>) {
	const severity = severityOf(entry)
	if (severity >= 17) return 'error'
	if (severity >= 13) return 'warn'
	if (severity >= 9) return 'info'
	if (severity >= 5) return 'debug'
	return 'trace'
}

// What text searches in an entry: its name and what it says, never its ids or times.
export function entryText(entry: Entry) {
	return String.toLowerCase(
		Array.join([entry.name, ...leaves(Struct.pick(entry.payload, ['attributes', 'body', 'events', 'status']))], ' ')
	)
}

// OTLP timestamps are nanoseconds since the epoch, so they compare exactly as BigInts.
const byTime = Order.mapInput(Order.BigInt, (time: string) => BigInt(time))

const byStart = Order.mapInput(byTime, (entry: {time: string}) => entry.time)

export function serviceStatuses(entries: Entry[]) {
	const runOf = runsOf(entries)
	return Record.collect(
		Array.groupBy(entries, entry => entry.service),
		(name, group) => {
			const latest = Array.max(group, Order.mapInput(Order.BigInt, runOf))
			const run = runOf(latest)
			const current = Array.filter(group, entry => runOf(entry) === run)
			return {
				entries: current.length,
				lastEventAt: Array.max(['0', ...Array.map(current, entry => entry.time)], byTime),
				name,
				runStartedAt: `${run}`,
				runtime: runtime(latest.resource),
				version: versionOf(latest)
			} satisfies ServiceStatus
		}
	)
}

// A trace's start and length, without assembling its tree.
export function traceTiming(records: Entry[]) {
	const spans = Array.filter(records, entry => entry.signal === 'trace')
	const start = Array.match(Array.match(spans, {onEmpty: () => records, onNonEmpty: Function.identity}), {
		onEmpty: () => '0',
		onNonEmpty: timed =>
			Array.min(
				Array.map(timed, entry => entry.time),
				byTime
			)
	})
	return {
		durationMs: Array.reduce(spans, 0, (end, span) => Number.max(end, durationMs(start, span.time) + span.durationMs)),
		time: start
	}
}

function parentId(entry: Entry) {
	if (String.isString(entry.payload['parentSpanId'])) return String.toLowerCase(entry.payload['parentSpanId'])
	return ''
}

// Effect marks every span a failure passed through as failed, so where it broke is the failed span with no failed child.
export function brokeAt(spans: readonly Entry[]) {
	const failedSpans = Array.filter(spans, failed)
	const parents = HashSet.fromIterable(Array.map(failedSpans, parentId))
	return Array.match(
		Array.filter(failedSpans, span => !HashSet.has(parents, span.spanId)),
		{onEmpty: () => Option.none(), onNonEmpty: candidates => Option.some(Array.min(candidates, byStart))}
	)
}

export function traceView(entries: Entry[], id: string) {
	const ordered = Array.sort(entries, byStart)
	const spans = Array.map(
		Array.filter(ordered, entry => entry.signal === 'trace'),
		(entry, index) => ({entry, index})
	)
	const byId = Record.fromEntries(Array.map(spans, span => [span.entry.spanId, span] as const))
	const timing = traceTiming(entries)
	const logs = Array.filter(ordered, entry => entry.signal === 'log')
	const bySpan = Array.groupBy(logs, log => log.spanId)

	const broken = brokeAt(Array.map(spans, span => span.entry))
	const tree = pipe(
		Array.map(spans, span => {
			const ancestors = Array.reverse(
				Array.unfold({entry: span.entry, seen: HashSet.make(span.entry.spanId)}, current =>
					pipe(
						Record.get(byId, parentId(current.entry)),
						Option.filter(parent => !HashSet.has(current.seen, parent.entry.spanId)),
						Option.map(
							parent => [parent, {entry: parent.entry, seen: HashSet.add(current.seen, parent.entry.spanId)}] as const
						)
					)
				)
			)
			return {
				path: [...Array.map(ancestors, parent => parent.index), span.index],
				value: {
					...span.entry,
					depth: ancestors.length,
					logs: Option.getOrElse(Record.get(bySpan, span.entry.spanId), () => []),
					offsetMs: durationMs(timing.time, span.entry.time),
					parentSpanId: parentId(span.entry),
					runtime: runtime(span.entry.resource)
				}
			}
		}),
		Array.sort(Order.Struct({path: Order.Array(Order.Number)})),
		Array.map(node => node.value)
	)
	return {
		durationMs: timing.durationMs,
		...Option.match(broken, {onNone: () => ({}), onSome: span => ({failureSpanId: span.spanId})}),
		id,
		logs: Array.filter(logs, log => !Record.has(byId, log.spanId)),
		services: Array.dedupeWith(
			Array.map([...tree, ...logs], entry => ({name: entry.service, runtime: runtime(entry.resource)})),
			(left, right) => left.name === right.name
		),
		spans: tree
	} satisfies Trace
}

// The span a trace starts from: one whose parent the trace doesn't hold, the earliest if a skewed clock leaves several.
export function traceRoot(spans: Array.NonEmptyReadonlyArray<Entry>) {
	const ids = HashSet.fromIterable(Array.map(spans, span => span.spanId))
	return Array.min(
		Array.match(
			Array.filter(spans, span => !HashSet.has(ids, parentId(span))),
			{onEmpty: () => spans, onNonEmpty: Function.identity}
		),
		byStart
	)
}

export type Traced = {app: string; name: string; runtime: Runtime; trace: OperationTrace}

function markedStream(entry: Entry) {
	return Array.some(
		spanAttributes(entry.payload),
		attribute => attribute.key === 'rpc.stream' && attribute.value['boolValue'] === true
	)
}

// A subscription's lifetime is not action latency. A nested subscription does not turn its owning action into one.
function subscription(root: Entry, spans: readonly Entry[]) {
	if (markedStream(root)) return true
	const method = resourceString({attributes: spanAttributes(root.payload)}, 'rpc.method')
	return Array.some(
		spans,
		span =>
			parentId(span) === root.spanId &&
			((root.name === 'POST /mcp' && String.includes('/subscriptions/listen')(span.name)) ||
				(method !== '' &&
					method === resourceString({attributes: spanAttributes(span.payload)}, 'rpc.method') &&
					markedStream(span)))
	)
}

// A machine's timer waits between steps; its lifetime is not the operation's latency.
function machineTimer(root: Entry) {
	return (
		root.payload['name'] === 'Machine.invoke' &&
		Option.getOrUndefined(attributePrimitive(spanAttributes(root.payload), 'machine.invoke.kind')) === 'Timer'
	)
}

function failureCount(group: readonly Traced[]) {
	return Array.countBy(group, item => item.trace.failure !== undefined)
}

// A trace is a row once its root has arrived, since children export first; one whose root never comes shows after a minute.
function traced(records: readonly Entry[], now: number) {
	return Option.flatMap(
		Array.match(
			Array.filter(records, entry => entry.signal === 'trace'),
			{onEmpty: () => Option.none(), onNonEmpty: Option.some}
		),
		spans => {
			const timing = traceTiming([...records])
			const settled =
				Array.some(spans, span => parentId(span) === '') ||
				now -
					pipe(
						Number.parse(`${BigInt(timing.time) / 1_000_000n}`),
						Option.getOrElse(() => now)
					) >
					60_000
			if (!settled) return Option.none()
			const root = traceRoot(spans)
			if (subscription(root, spans) || machineTimer(root)) return Option.none()
			return Option.some({
				app: appName(root.service),
				name: root.name,
				runtime: runtime(root.resource),
				trace: {
					durationMs: timing.durationMs,
					...Option.match(brokeAt(spans), {
						onNone: () => ({}),
						onSome: span => {
							const error = failureMessage(span.payload)
							return {
								failure: {
									span: span.name,
									...Boolean.match(String.isNonEmpty(error), {onFalse: () => ({}), onTrue: () => ({error})})
								}
							}
						}
					}),
					id: root.traceId,
					...Option.match(
						Option.flatMap(
							Array.findFirst(spanAttributes(root.payload), attribute => attribute.key === 'trace.label'),
							attribute => Option.liftPredicate(attribute.value['stringValue'], String.isString)
						),
						{onNone: () => ({}), onSome: label => ({label})}
					),
					time: timing.time
				}
			} satisfies Traced)
		}
	)
}

// Every trace in one snapshot, grouped once and shared by all its time frames.
export function tracedOf(entries: readonly Entry[], now: number) {
	return Array.getSomes(
		Array.map(
			Record.values(
				Array.groupBy(
					Array.filter(entries, entry => entry.traceId !== ''),
					entry => entry.traceId
				)
			),
			records => traced(records, now)
		)
	)
}

function tracedOperations(group: readonly Traced[]) {
	return Array.map(Record.toEntries(Array.groupBy(group, item => `${item.runtime} ${item.name}`)), entry => {
		const times = Array.sort(
			Array.map(entry[1], item => item.trace.durationMs),
			Order.Number
		)
		return {
			count: entry[1].length,
			failures: failureCount(entry[1]),
			name: Array.headNonEmpty(entry[1]).name,
			p50Ms: percentile(times, 0.5),
			p95Ms: percentile(times, 0.95),
			runtime: Array.headNonEmpty(entry[1]).runtime,
			// The slowest first, with the newest failures always among them, since those are the traces worth opening.
			traces: Array.map(
				Array.sort(
					Array.take(
						Array.dedupeWith(
							[
								...Array.take(
									Array.sort(
										Array.filter(entry[1], item => item.trace.failure !== undefined),
										Order.flip(Order.mapInput(byTime, (item: Traced) => item.trace.time))
									),
									KEEP / 2
								),
								...Array.sort(
									entry[1],
									Order.mapInput(Order.flip(Order.Number), (item: Traced) => item.trace.durationMs)
								)
							],
							(first: Traced, second: Traced) => first.trace.id === second.trace.id
						),
						KEEP
					),
					Order.mapInput(Order.flip(Order.Number), (item: Traced) => item.trace.durationMs)
				),
				item => item.trace
			)
		} satisfies Operation
	})
}

// Apps with failures lead, then the busiest; each app's operations count only the traces started in the page's time frame, so a quiet app keeps its tab with no rows.
export function overviewOf(traces: readonly Traced[], now: number, range: Range) {
	const cutoff = rangeStart(range, now)
	return {
		apps: Array.map(
			Array.sort(
				Record.values(Array.groupBy(traces, item => item.app)),
				Order.combine(
					Order.mapInput(Order.flip(Order.Number), (group: readonly Traced[]) => failureCount(group)),
					Order.mapInput(Order.flip(Order.Number), (group: readonly Traced[]) => group.length)
				)
			),
			group => ({
				ci: Array.every(group, item => item.runtime === 'ci'),
				name: Array.headNonEmpty(group).app,
				operations: tracedOperations(Array.filter(group, item => BigInt(item.trace.time) >= cutoff))
			})
		)
	} satisfies Overview
}

export function overview(entries: readonly Entry[], now: number, range: Range) {
	return overviewOf(tracedOf(entries, now), now, range)
}

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/scope/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layerProtocol
}) {}

export type NavigationEvent =
	| {readonly _tag: 'Back'}
	| {readonly _tag: 'Operation'; readonly operation: OperationKey}
	| {readonly _tag: 'Range'; readonly keepTrace: boolean; readonly range: Range}
	| {readonly _tag: 'Source'; readonly app: string}
	| {readonly _tag: 'Span'; readonly selection: {operation: OperationKey; spanId: string; traceId: string}}
	| {readonly _tag: 'Trace'; readonly selection: {operation: OperationKey; traceId: string}}

export function navigationOf(search: Search) {
	return {
		path: search.pane ?? 'Operations',
		selection: Option.getOrUndefined(
			Option.map(
				Option.fromUndefinedOr(search.side),
				side =>
					({
						operation: {app: search.source ?? '', name: search.operation ?? '', runtime: side},
						...Option.match(Option.fromUndefinedOr(search.trace), {onNone: () => ({}), onSome: traceId => ({traceId})}),
						...Option.match(Option.fromUndefinedOr(search.span), {onNone: () => ({}), onSome: spanId => ({spanId})})
					}) satisfies Selection
			)
		)
	}
}

// The URL a selection produces in the given pane; a pick keeps the pane it was made in and the page's time frame.
function select(selection: Selection, frame?: Range, pane?: Pane) {
	return {
		operation: selection.operation.name,
		...Option.match(Option.fromUndefinedOr(frame), {onNone: () => ({}), onSome: range => ({range})}),
		side: selection.operation.runtime,
		source: selection.operation.app,
		...Option.match(Option.fromUndefinedOr(pane), {onNone: () => ({}), onSome: current => ({pane: current})}),
		...Option.match(Option.fromUndefinedOr(selection.traceId), {onNone: () => ({}), onSome: trace => ({trace})}),
		...Option.match(Option.fromUndefinedOr(selection.spanId), {onNone: () => ({}), onSome: span => ({span})})
	} satisfies Search
}

// The bar chooses one app at a time and clears the selection it no longer contains; choosing the chosen app again changes nothing.
function sourceSearch(search: Search, app: string) {
	if (search.source === app) return search
	return {...Struct.omit(search, ['operation', 'pane', 'side', 'span', 'trace']), source: app}
}

export function nextSearch(search: Search, event: NavigationEvent) {
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
	return Option.match(
		Option.flatMap(Option.fromUndefinedOr(search.pane), current => Record.get(UP, current)),
		{onNone: () => ({...Struct.omit(search, ['pane']), pane: undefined}), onSome: up => ({...search, pane: up})}
	) satisfies Search
}

// The app a plain open lands on: the one whose newest failed trace is newest, else the first tab.
function openingApp(frame: Overview) {
	const failedTraces = Array.flatMap(frame.apps, app =>
		Array.flatMap(app.operations, operation =>
			Array.getSomes(
				Array.map(operation.traces, trace =>
					Option.map(Option.fromUndefinedOr(trace.failure), () => ({app: app.name, time: BigInt(trace.time)}))
				)
			)
		)
	)
	return Option.orElse(
		Option.map(
			Array.match(failedTraces, {
				onEmpty: () => Option.none<{app: string; time: bigint}>(),
				onNonEmpty: entries =>
					Option.some(
						Array.max(
							entries,
							Order.mapInput(Order.BigInt, entry => entry.time)
						)
					)
			}),
			entry => entry.app
		),
		() => Option.map(Array.head(frame.apps), app => app.name)
	)
}

export const overviewAtom = Atom.family((range: Range) =>
	Atom.keepAlive(
		RpcClient.runtime.atom(get =>
			WebRuntime.live(
				get,
				pipe(
					RpcClient,
					Effect.map(client => client('scope.overview', range)),
					Stream.unwrap
				)
			)
		)
	)
)

const traceAtoms = Atom.family((range: Range) =>
	Atom.family((_id: string) =>
		RpcClient.runtime.atom(get => {
			get(overviewAtom(range))
			return WebRuntime.live(
				get,
				Stream.fromEffect(Effect.flatMap(RpcClient, client => client('scope.trace', {id: _id})))
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

export function ageOf(time: string, now: number) {
	return Option.match(Number.parse(pipe(time, String.slice(0, -6))), {
		onNone: () => '—',
		onSome: timestamp => {
			const seconds = Number.max(0, (now - timestamp) / 1000)
			if (seconds < 10) return 'now'
			if (seconds < 60) return `${Number.round(seconds, 0)}s`
			if (seconds < 3600) return `${Number.round(seconds / 60, 0)}m`
			if (seconds < 86_400) return `${Number.round(seconds / 3600, 0)}h`
			return `${Number.round(seconds / 86_400, 0)}d`
		}
	})
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

// An attribute's value as OTLP wraps it, such as {stringValue: "…"}, shown as its one value.
function valueOf(value: Schema.Json) {
	return pipe(
		Schema.decodeUnknownOption(Wrapped)(value),
		Option.flatMap(wrapped => Array.head(Record.values(wrapped))),
		Option.filter(inner => Predicate.isString(inner) || Predicate.isNumber(inner) || Predicate.isBoolean(inner)),
		Option.match({onNone: () => Formatter.formatJson(value), onSome: inner => `${inner}`})
	)
}

export function errorOf(span: Trace['spans'][number]) {
	return pipe(
		Option.liftPredicate(span, current => current.status === 2),
		Option.flatMap(current => Option.fromNullishOr(current.payload['status'])),
		Option.filter(Predicate.isObject),
		Option.flatMap(status => Option.fromNullishOr(pipe(Record.get(status, 'message'), Option.getOrUndefined))),
		Option.filter(String.isString),
		Option.filter(String.isNonEmpty)
	)
}

// Attributes, without anything that only repeats the row: its name, code.function, or the status code the error line carries.
export function attributesOf(span: Trace['spans'][number]) {
	if (span.payload['attributes'] === undefined) return []
	return Option.match(Schema.decodeUnknownOption(Attributes)(span.payload['attributes']), {
		onNone: () => [{key: 'attributes', value: 'Unreadable'}],
		onSome: decoded => {
			const failing = Option.isSome(errorOf(span)) && span.denied !== true
			const attributes = Array.map(
				Array.filter(decoded, attribute => attribute.key !== 'service.name'),
				attribute => ({key: attribute.key, value: valueOf(attribute.value)})
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
	})
}

// The most recent trace an operation started, which orders the list after failures.
function latestOf(operation: Operation) {
	return Array.match(operation.traces, {
		onEmpty: () => 0n,
		onNonEmpty: traces =>
			BigInt(
				Array.max(
					traces,
					Order.mapInput(Order.BigInt, (trace: OperationTrace) => BigInt(trace.time))
				).time
			)
	})
}

// One app's operations: failing first, then most recent.
export function operationsOf(frame: Overview, source?: string) {
	return Array.sort(
		Array.flatMap(
			Array.filter(frame.apps, (app: Overview['apps'][number]) => app.name === source),
			(app: Overview['apps'][number]) => Array.map(app.operations, operation => ({app, operation}))
		),
		Order.combine(
			Order.mapInput(Order.flip(Order.Boolean), (row: ActiveOperation) => row.operation.failures > 0),
			Order.mapInput(Order.flip(Order.BigInt), (row: ActiveOperation) => latestOf(row.operation))
		)
	)
}

function findOperation(frame: Overview, key: OperationKey) {
	return Option.flatMap(
		Array.findFirst(frame.apps, app => app.name === key.app),
		app =>
			Option.map(
				Array.findFirst(app.operations, operation => operation.runtime === key.runtime && operation.name === key.name),
				operation => ({app, operation})
			)
	)
}

// The span the URL picks, else where the failure broke, else the first span.
export function focusOf(trace: Trace, pickedSpan?: string) {
	return Option.orElse(
		Array.findFirst(trace.spans, span => span.spanId === pickedSpan),
		() =>
			Option.orElse(
				Option.flatMap(Option.fromUndefinedOr(trace.failureSpanId), id =>
					Array.findFirst(trace.spans, span => span.spanId === id)
				),
				() => Array.findFirst(trace.spans, span => span.depth === 0)
			)
	)
}

// The app, operation, trace and span the URL selects; a desktop layout defaults to the app's first operation and phone starts empty.
export function selectionOf(frame: Option.Option<Overview>, search: Search, mobile: boolean) {
	const source = Option.getOrUndefined(
		Option.orElse(
			Option.filter(Option.fromUndefinedOr(search.source), name =>
				Option.exists(frame, current => Array.some(current.apps, app => app.name === name))
			),
			() => Option.flatMap(frame, openingApp)
		)
	)
	const selection = navigationOf(search).selection
	const activeOperation = Option.orElse(
		Option.filter(
			Option.flatMap(Option.fromUndefinedOr(selection?.operation), key =>
				Option.flatMap(frame, current => findOperation(current, key))
			),
			active => active.app.name === source
		),
		() =>
			Boolean.match(mobile, {
				onFalse: () =>
					Option.flatMap(frame, current =>
						Option.map(Array.head(operationsOf(current, source)), row => ({app: row.app, operation: row.operation}))
					),
				onTrue: () => Option.none<ActiveOperation>()
			})
	)
	const activeKey = Option.map(activeOperation, active => ({
		app: active.app.name,
		name: active.operation.name,
		runtime: active.operation.runtime
	}))
	const activeTrace = Option.flatMap(activeOperation, active =>
		Option.orElse(
			Option.flatMap(Option.fromUndefinedOr(selection?.traceId), selected =>
				Array.findFirst(active.operation.traces, trace => trace.id === selected)
			),
			() => Array.head(active.operation.traces)
		)
	)
	const pickedSpan = Option.getOrUndefined(
		Option.flatMap(
			Option.filter(Option.fromUndefinedOr(selection), selected =>
				Option.exists(activeTrace, trace => selected.traceId === trace.id)
			),
			selected => Option.fromUndefinedOr(selected.spanId)
		)
	)
	return {activeKey, activeOperation, activeTrace, pickedSpan, source}
}
