import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Function,
	HashSet,
	Number,
	Option,
	Order,
	Predicate,
	Record,
	Schema,
	String,
	Struct,
	pipe
} from 'effect'

import {Model} from 'effect/schema'

import {Nano, rangeStart, Runtime, Side, Span} from '#services/telemetry/schema.ts'
import type {
	Attribute,
	Attributes,
	ExportedSpan,
	Log,
	LogsRequest,
	Operation,
	OperationTrace,
	Overview,
	Range,
	Resource,
	SpanLink,
	TraceTree,
	TracesRequest
} from '#services/telemetry/schema.ts'

// Each operation lists this many traces, its newest failures among them.
const KEEP = 20

// Releases compare part by part as numbers, so 0.1.1235 is newer than 0.1.999.
const byRelease = Order.mapInput(Order.Array(Order.Number), (version: string) =>
	Array.map(String.split(version, '.'), part => Option.getOrElse(Number.parse(part), () => 0))
)

const byStart = Order.mapInput(Order.Number, (span: Pick<Span, 'start'>) => span.start)

export type Sender = {readonly service: string; readonly version: Option.Option<string>}

// The fields a judgement of a trace reads, whether the span is stored or still arriving.
export type SpanFacts = Pick<
	Span,
	'attributes' | 'duration' | 'name' | 'parentSpanId' | 'spanId' | 'start' | 'status' | 'traceId'
>

// A version Scope can order, numbers joined by dots such as "0.1.1235"; OTel leaves `service.version` free text, so "1.2.0-rc.1" or a commit hash is never older than anything.
function releaseOf(version: Option.Option<string>) {
	return Option.filter(version, value => Option.isSome(String.match(/^\d+(?:\.\d+)*$/u)(value)))
}

// Each service's newest release among the senders and the ones already known.
export function newestReleases(senders: readonly Sender[], known: Record<string, string>) {
	const versioned = Array.getSomes(
		Array.map(senders, sender => Option.map(releaseOf(sender.version), version => ({service: sender.service, version})))
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

// What an older release than its service's newest sent.
export function supersededBy(newest: Record<string, string>) {
	return (sender: Sender) =>
		Option.exists(releaseOf(sender.version), version =>
			Option.exists(Record.get(newest, sender.service), latest => Order.isLessThan(byRelease)(version, latest))
		)
}

// An OTLP attribute's one primitive value, unwrapped; an integer past what a number holds exactly stays the string OTLP sent.
function primitiveOf(value: unknown) {
	if (Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)) return value
	if (value === null || !Predicate.isObject(value) || Array.isArray(value)) return undefined
	const integer = value['intValue']
	if (Predicate.isNumber(integer)) return integer
	if (Predicate.isString(integer)) {
		return Option.getOrElse(
			// The largest integer a number holds exactly is 2⁵³ − 1.
			Option.filter(Number.parse(integer), parsed => Math.abs(parsed) <= 2 ** 53 - 1),
			() => integer
		)
	}
	const double = value['doubleValue']
	if (Predicate.isNumber(double)) return double
	const bool = value['boolValue']
	if (Predicate.isBoolean(bool)) return bool
	const string = value['stringValue']
	if (Predicate.isString(string)) return string
	return undefined
}

// OTLP's attribute list as one object, each primitive unwrapped; an array or map keeps the shape OTLP sent.
function attributesOf(attributes: readonly Attribute[] = []) {
	return Record.fromEntries(
		Array.map(attributes, attribute => [attribute.key, primitiveOf(attribute.value) ?? attribute.value] as const)
	)
}

function textOf(attributes: Attributes, key: string) {
	return Option.getOrElse(Option.liftPredicate(attributes[key], Predicate.isString), () => '')
}

function resourceText(resource: Resource, key: string) {
	return textOf(attributesOf(resource.attributes), key)
}

// Effect names an HTTP span by its method alone: its route, or a client's path, says which request it was; unrouted server hits, mostly scanners, share one name. A machine step is named for its source.
function spanName(span: ExportedSpan, attributes: Attributes) {
	const name = span.name ?? ''
	if (name === '') return name
	if (name === 'Machine.invoke') {
		const source = textOf(attributes, 'machine.invoke.source')
		if (String.isNonEmpty(source)) return `Machine.invoke ${source}`
	}
	if (name !== textOf(attributes, 'http.request.method')) return name
	const route = textOf(attributes, 'http.route')
	if (String.isNonEmpty(route)) return `${name} ${route}`
	// OTLP's SpanKind 2 is a server answering a request.
	if (span['kind'] === 2) return `${name} (no route)`
	return pipe(
		Option.liftPredicate(textOf(attributes, 'url.path'), String.isNonEmpty),
		Option.match({onNone: () => name, onSome: path => `${name} ${path}`})
	)
}

export function appName(service: string) {
	return pipe(service, String.replace(/^@deslop\//u, ''), String.replace(/-(?:server|client|ios)$/u, ''))
}

// The tool's side: the resource's runtime, else the suffix its service name already carries; unknown names omit it.
export function sideFor(service: string, value: Runtime) {
	if (Schema.is(Side)(value)) return value
	if (String.endsWith('-server')(service)) return 'server' as const
	if (String.endsWith('-client')(service)) return 'web' as const
	if (String.endsWith('-ios')(service)) return 'mobile' as const
	return undefined
}

function serviceName(resource: Resource) {
	const value = resourceText(resource, 'service.name')
	if (String.isNonEmpty(value)) return value
	return 'unknown'
}

// OTLP nanoseconds as epoch milliseconds, keeping microseconds.
function millisOf(nano: string) {
	return Option.getOrThrow(Number.parse(`${BigInt(nano) / 1000n}`)) / 1000
}

function durationMs(start: string, end: string) {
	if (BigInt(end) < BigInt(start)) return 0
	return Option.getOrThrow(Number.parse(`${BigInt(end) - BigInt(start)}`)) / 1_000_000
}

// Who sent a record: its service, the side it runs on, the run its process started and the release it built.
function senderOf(resource: Resource) {
	return {
		run: pipe(
			Option.liftPredicate(resourceText(resource, 'scope.run.started_unix_nano'), Schema.is(Nano)),
			Option.map(nano => DateTime.makeUnsafe(Math.trunc(millisOf(nano))))
		),
		runtime: Option.getOrElse(
			Option.liftPredicate(resourceText(resource, 'scope.runtime'), Schema.is(Runtime)),
			() => 'unknown' as const
		),
		service: serviceName(resource),
		version: Option.liftPredicate(resourceText(resource, 'service.version'), String.isNonEmpty)
	}
}

function lowerId(id = '') {
	return Option.map(Option.liftPredicate(id, String.isNonEmpty), String.toLowerCase)
}

// The words and numbers of an OTLP value, keys included: `Effect.log('saved', note)` sends an array of its arguments.
function leaves(value: Schema.Json): string[] {
	if (Array.isArray<Schema.Json>(value)) return Array.flatMap(value, leaves)
	if (String.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)) return [`${value}`]
	if (value === null) return []
	return Array.flatMap(Record.values(value), leaves)
}

// A span is denied when every exception event is an AuthError, or its HTTP response is 401 or 403.
function deniedSpan(attributes: Attributes, exceptions: readonly Attributes[]) {
	const code = attributes['http.response.status_code']
	if (code === 401 || code === 403) return true
	return Array.match(exceptions, {
		onEmpty: () => false,
		onNonEmpty: found => Array.every(found, exception => textOf(exception, 'exception.type') === 'AuthError')
	})
}

// The rows an OTLP traces export stores: one per span, and one per link into another trace.
export function spansOf(payload: TracesRequest) {
	const spans = Array.flatMap(payload.resourceSpans ?? [], group =>
		Array.flatMap(group.scopeSpans ?? [], scope =>
			Array.map(scope.spans ?? [], span => {
				const attributes = attributesOf(span.attributes)
				const exceptions = Array.map(
					Array.filter(span.events ?? [], event => event.name === 'exception'),
					event => attributesOf(event.attributes)
				)
				const failed = span.status?.code === 2
				const traceId = String.toLowerCase(span.traceId)
				const spanId = String.toLowerCase(span.spanId)
				return {
					links: Array.flatMap(span.links ?? [], link =>
						Boolean.match(String.toLowerCase(link.traceId) === traceId, {
							onFalse: () => [
								{
									linkedSpanId: String.toLowerCase(link.spanId),
									linkedTraceId: String.toLowerCase(link.traceId),
									spanId,
									traceId
								}
							],
							onTrue: () => []
						})
					),
					span: Span.insert.make({
						...senderOf(group.resource ?? {}),
						attributes,
						duration: Option.map(Option.fromUndefinedOr(span.endTimeUnixNano), end =>
							Duration.millis(durationMs(span.startTimeUnixNano, end))
						),
						error: Option.filter(
							Option.liftPredicate(span.status?.['message'], Predicate.isString),
							message => failed && String.isNonEmpty(message)
						),
						exception: Option.filter(
							Option.map(Array.head(exceptions), exception => textOf(exception, 'exception.message')),
							String.isNonEmpty
						),
						name: spanName(span, attributes),
						parentSpanId: lowerId(span.parentSpanId),
						spanId,
						start: millisOf(span.startTimeUnixNano),
						status: Boolean.match(failed, {
							onFalse: () => 'ok' as const,
							onTrue: () =>
								Boolean.match(deniedSpan(attributes, exceptions), {
									onFalse: () => 'failed' as const,
									onTrue: () => 'denied' as const
								})
						}),
						traceId
					})
				}
			})
		)
	)
	return {links: Array.flatMap(spans, item => item.links), spans: Array.map(spans, item => item.span)}
}

// A severity as OTLP's number; a record with only a text level maps onto the same scale.
function severityOf(number?: number, text = '') {
	if (number !== undefined) return number
	const level = String.toUpperCase(text)
	if (level === 'FATAL' || level === 'ERROR') return 17
	if (level === 'WARN') return 13
	if (level === 'INFO') return 9
	if (level === 'DEBUG') return 5
	return 0
}

// One log record of an OTLP logs export, under the identity its digest gave it.
export function logOf(
	group: NonNullable<LogsRequest['resourceLogs']>[number],
	log: NonNullable<
		NonNullable<NonNullable<LogsRequest['resourceLogs']>[number]['scopeLogs']>[number]['logRecords']
	>[number],
	id: string,
	receivedAt: number
) {
	return {
		...senderOf(group.resource ?? {}),
		attributes: attributesOf(log.attributes),
		id,
		message: Array.join(leaves(log.body ?? {}), ' '),
		receivedAt: Model.Override(DateTime.makeUnsafe(receivedAt)),
		severity: severityOf(log.severityNumber, log.severityText),
		spanId: lowerId(log.spanId),
		time: millisOf(log.timeUnixNano),
		traceId: lowerId(log.traceId)
	} satisfies typeof Log.insert.Type
}

export function levelOf(severity: number) {
	if (severity >= 17) return 'error'
	if (severity >= 13) return 'warn'
	if (severity >= 9) return 'info'
	if (severity >= 5) return 'debug'
	return 'trace'
}

// The diagnostic a failed span is remembered by: its exception's message or its status line, first line only, no stack trace.
export function diagnosis(span: Pick<Span, 'error' | 'exception'>) {
	return pipe(
		Option.getOrElse(
			Option.orElse(span.exception, () => span.error),
			() => ''
		),
		value => Array.head(String.split(value, '\n')),
		Option.getOrElse(() => ''),
		String.trim,
		String.slice(0, 300)
	)
}

// One flat object of primitive attribute values, without keys that only repeat the span or carry no diagnosis.
export function attributesFlat(attributes: Attributes, name: string, failedSpan: boolean) {
	const entries = pipe(
		Record.toEntries(attributes),
		Array.flatMap(entry => {
			const value = entry[1]
			if (Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)) {
				return [[entry[0], value] as const]
			}
			return []
		}),
		Array.filter(entry => {
			const key = entry[0]
			const value = entry[1]
			if (
				Array.contains(
					// `url.full` already holds the path, query and host.
					['service.name', 'rpc.system.name', 'url.scheme', 'server.port', 'url.path', 'url.query', 'server.address'],
					key
				) ||
				String.startsWith('code.')(key)
			) {
				return false
			}
			if (key === 'http.request.method' && String.startsWith(`${value}`)(name)) return false
			if (key === 'client.address' && (value === '127.0.0.1' || value === '::1')) return false
			if (key === 'rpc.method' && value === name) return false
			if (key === 'user_agent.original' && !failedSpan) return false
			return value !== name
		})
	)
	if (Array.isReadonlyArrayEmpty(entries)) return undefined
	return Record.fromEntries(entries)
}

export function isoTime(milliseconds: number) {
	return DateTime.formatIso(DateTime.makeUnsafe(Math.trunc(milliseconds)))
}

export function rounded(ms: number) {
	return Number.round(ms, 1)
}

// How long a span ran; an open one has run no time yet.
function spanMs(span: Pick<Span, 'duration'>) {
	return Option.match(span.duration, {onNone: () => 0, onSome: Duration.toMillis})
}

function markedStream(span: Pick<Span, 'attributes'>) {
	return span.attributes['rpc.stream'] === true
}

// A subscription's lifetime is not action latency. A nested subscription does not turn its owning action into one.
function subscription(root: SpanFacts, spans: readonly SpanFacts[]) {
	if (markedStream(root)) return true
	const method = textOf(root.attributes, 'rpc.method')
	return Array.some(
		spans,
		span =>
			Option.contains(span.parentSpanId, root.spanId) &&
			((root.name === 'POST /mcp' && String.includes('/subscriptions/listen')(span.name)) ||
				(method !== '' && method === textOf(span.attributes, 'rpc.method') && markedStream(span)))
	)
}

// Effect marks every span a failure passed through as failed, so where it broke is the failed span with no failed child.
function brokeAt<A extends SpanFacts>(spans: readonly A[]) {
	const failedSpans = Array.filter(spans, span => span.status === 'failed')
	const parents = HashSet.fromIterable(Array.getSomes(Array.map(failedSpans, span => span.parentSpanId)))
	return Array.match(
		Array.filter(failedSpans, span => !HashSet.has(parents, span.spanId)),
		{onEmpty: () => Option.none<A>(), onNonEmpty: candidates => Option.some(Array.min(candidates, byStart))}
	)
}

// The span a trace starts from: one whose parent the trace doesn't hold, the earliest if a skewed clock leaves several.
function traceRoot<A extends SpanFacts>(spans: Array.NonEmptyReadonlyArray<A>) {
	const ids = HashSet.fromIterable(Array.map(spans, span => span.spanId))
	return Array.min(
		Array.match(
			Array.filter(spans, span => !Option.exists(span.parentSpanId, parent => HashSet.has(ids, parent))),
			{onEmpty: () => spans, onNonEmpty: Function.identity}
		),
		byStart
	)
}

// A trace's start and length, without assembling its tree.
function timingOf(spans: Array.NonEmptyReadonlyArray<SpanFacts>) {
	const start = Array.min(
		Array.map(spans, span => span.start),
		Order.Number
	)
	return {durationMs: Array.reduce(spans, 0, (end, span) => Number.max(end, span.start - start + spanMs(span))), start}
}

// What every list reads of one trace, judged from all of its spans.
function traceOf(spans: Array.NonEmptyReadonlyArray<SpanFacts>, receivedAt: number) {
	const root = traceRoot(spans)
	const timing = timingOf(spans)
	return {
		broken: Option.map(brokeAt(spans), span => span.spanId),
		duration: Duration.millis(timing.durationMs),
		id: root.traceId,
		receivedAt: Model.Override(DateTime.makeUnsafe(receivedAt)),
		root: root.spanId,
		rooted: Array.some(spans, span => Option.isNone(span.parentSpanId)),
		start: timing.start,
		// A machine's timer waits between steps; its lifetime is not the operation's latency either.
		waits:
			subscription(root, spans) ||
			(String.startsWith('Machine.invoke')(root.name) && root.attributes['machine.invoke.kind'] === 'Timer')
	}
}

// The traces an export touches, whose stored spans `touchedTraces` reads again.
export function traceIdsOf(spans: readonly SpanFacts[]) {
	return Array.dedupe(Array.map(spans, span => span.traceId))
}

// Each trace an export touches, judged again over its stored spans with the arriving copies in place of theirs.
export function touchedTraces(incoming: readonly SpanFacts[], stored: readonly SpanFacts[], receivedAt: number) {
	const arriving = HashSet.fromIterable(Array.map(incoming, span => `${span.traceId}:${span.spanId}`))
	return Array.map(
		Record.values(
			Array.groupBy(
				[...Array.filter(stored, span => !HashSet.has(arriving, `${span.traceId}:${span.spanId}`)), ...incoming],
				span => span.traceId
			)
		),
		spans => traceOf(spans, receivedAt)
	)
}

// Each linked trace's root hangs under the span it links to, its own link first.
function linkedParents(spans: readonly Span[], links: readonly SpanLink[]) {
	const ids = HashSet.fromIterable(Array.map(spans, span => span.spanId))
	const linksOf = Array.groupBy(links, link => `${link.traceId}:${link.spanId}`)
	return Record.fromEntries(
		Array.flatMap(Record.values(Array.groupBy(spans, span => span.traceId)), group => {
			const root = traceRoot(group)
			return Option.match(
				Array.findFirst([root, ...group], span =>
					Array.findFirst(Option.getOrElse(Record.get(linksOf, `${span.traceId}:${span.spanId}`), Array.empty), link =>
						HashSet.has(ids, link.linkedSpanId)
					)
				),
				{onNone: () => [], onSome: link => [[root.spanId, link.linkedSpanId] as const]}
			)
		})
	)
}

// A trace and the traces its links join, as one tree in start order with each span's logs beside it.
export function traceTree(id: string, spans: readonly Span[], logs: readonly Log[], links: readonly SpanLink[]) {
	const ordered = Array.sort(spans, byStart)
	const indexed = Array.map(ordered, (span, index) => ({index, span}))
	const byId = Record.fromEntries(Array.map(indexed, item => [item.span.spanId, item] as const))
	const linked = linkedParents(ordered, links)
	function parentOf(span: Span) {
		return Option.orElse(Record.get(linked, span.spanId), () => span.parentSpanId)
	}
	const sortedLogs = Array.sort(
		logs,
		Order.mapInput(Order.Number, (log: Log) => log.time)
	)
	const timing = Array.match(ordered, {
		onEmpty: () => ({
			durationMs: 0,
			start: Option.getOrElse(
				Option.map(Array.head(sortedLogs), log => log.time),
				() => 0
			)
		}),
		onNonEmpty: timingOf
	})
	const bySpan = Array.groupBy(
		Array.filter(sortedLogs, log => Option.isSome(log.spanId)),
		log => Option.getOrElse(log.spanId, () => '')
	)
	const tree = pipe(
		Array.map(indexed, item => {
			const ancestors = Array.reverse(
				Array.unfold({seen: HashSet.make(item.span.spanId), span: item.span}, current =>
					pipe(
						Option.flatMap(parentOf(current.span), parent => Record.get(byId, parent)),
						Option.filter(parent => !HashSet.has(current.seen, parent.span.spanId)),
						Option.map(
							parent => [parent, {seen: HashSet.add(current.seen, parent.span.spanId), span: parent.span}] as const
						)
					)
				)
			)
			return {
				path: [...Array.map(ancestors, parent => parent.index), item.index],
				value: {
					...Struct.pick(item.span, Struct.keys(Span.json.fields)),
					depth: ancestors.length,
					durationMs: spanMs(item.span),
					logs: Option.getOrElse(Record.get(bySpan, item.span.spanId), Array.empty),
					offsetMs: item.span.start - timing.start,
					parentSpanId: parentOf(item.span)
				}
			}
		}),
		Array.sort(Order.Struct({path: Order.Array(Order.Number)})),
		Array.map(node => node.value)
	)
	return {
		durationMs: timing.durationMs,
		...Option.match(brokeAt(ordered), {onNone: () => ({}), onSome: span => ({failureSpanId: span.spanId})}),
		id,
		logs: Array.filter(sortedLogs, log => !Option.exists(log.spanId, spanId => Record.has(byId, spanId))),
		spans: tree
	} satisfies TraceTree
}

// A settled trace as the overview counts it; only the traces it keeps get their label and failure.
export type Traced = {app: string; failed: boolean; name: string; runtime: Runtime; trace: OperationTrace}

function failureCount(group: readonly Traced[]) {
	return Array.countBy(group, item => item.failed)
}

function percentile(times: readonly number[], ratio: number) {
	return Option.getOrElse(Array.get(times, Number.max(0, Math.ceil(times.length * ratio) - 1)), () => 0)
}

// The p50, p95 and longest of some durations in milliseconds.
export function latencyOf(times: readonly number[]) {
	const sorted = Array.sort(times, Order.Number)
	return {
		maxMs: Option.getOrElse(Array.last(sorted), () => 0),
		p50Ms: percentile(sorted, 0.5),
		p95Ms: percentile(sorted, 0.95)
	}
}

const slowestFirst = Order.mapInput(Order.flip(Duration.Order), (item: Traced) => item.trace.duration)

// From an operation's traces slowest first: the slowest, with the newest failures always among them, since those are the traces worth opening.
function keptTraces(slowest: Array.NonEmptyReadonlyArray<Traced>) {
	const newestFailures = HashSet.fromIterable(
		Array.map(
			Array.take(
				Array.sort(
					Array.filter(slowest, item => item.failed),
					Order.mapInput(Order.flip(Order.Number), (item: Traced) => item.trace.start)
				),
				KEEP / 2
			),
			item => item.trace.id
		)
	)
	// The newest failures, then the slowest of the rest: the sort is stable, so each part stays slowest first.
	const chosenFirst = Array.sort(
		slowest,
		Order.mapInput(Order.flip(Order.Boolean), (item: Traced) => HashSet.has(newestFailures, item.trace.id))
	)
	return Array.map(Array.sort(Array.splitAtNonEmpty(chosenFirst, KEEP)[0], slowestFirst), item => item.trace)
}

type Ordered = {latest: number; operation: Operation}

// Failing first, then most recently seen: the order the page and the tools list an app's operations in.
function tracedOperations(group: readonly Traced[]) {
	return Array.map(
		Array.sort(
			Array.map(Record.values(Array.groupBy(group, item => `${item.runtime} ${item.name}`)), operation => {
				const slowest = Array.sort(operation, slowestFirst)
				// Already in order, so sorting the durations again costs one pass.
				const latency = latencyOf(Array.reverse(Array.map(slowest, item => Duration.toMillis(item.trace.duration))))
				return {
					latest: Array.max(
						Array.map(operation, item => item.trace.start),
						Order.Number
					),
					operation: {
						count: operation.length,
						failures: failureCount(operation),
						name: Array.headNonEmpty(operation).name,
						p50Ms: latency.p50Ms,
						p95Ms: latency.p95Ms,
						runtime: Array.headNonEmpty(operation).runtime,
						traces: keptTraces(slowest)
					} satisfies Operation
				}
			}),
			Order.combine(
				Order.mapInput(Order.flip(Order.Boolean), (item: Ordered) => item.operation.failures > 0),
				Order.mapInput(Order.flip(Order.Number), (item: Ordered) => item.latest)
			)
		),
		item => item.operation
	)
}

// Apps with failures lead, then the busiest; each app's operations count only the traces started in the page's time frame, so a quiet app keeps its tab with no rows.
export function overviewOf(traces: readonly Traced[], now: number, range: Range) {
	const cutoff = rangeStart(range, now)
	return {
		apps: Array.map(
			Array.sort(
				Array.map(Record.values(Array.groupBy(traces, item => item.app)), group => ({
					failures: failureCount(group),
					group
				})),
				Order.combine(
					Order.mapInput(Order.flip(Order.Number), (app: {failures: number; group: readonly Traced[]}) => app.failures),
					Order.mapInput(
						Order.flip(Order.Number),
						(app: {failures: number; group: readonly Traced[]}) => app.group.length
					)
				)
			),
			app => ({
				ci: Array.every(app.group, item => item.runtime === 'ci'),
				name: Array.headNonEmpty(app.group).app,
				operations: tracedOperations(Array.filter(app.group, item => item.trace.start >= cutoff))
			})
		)
	} satisfies Overview
}
