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

import {
	AppName,
	Nano,
	ReleaseVersion,
	Runtime,
	ServiceName,
	Side,
	Span,
	SpanId,
	TraceId
} from '#services/telemetry/schema.ts'
import type {
	Attribute,
	Attributes,
	ExportedSpan,
	ExportedLog,
	Log,
	LogId,
	Origin,
	CountedOperation,
	OperationTrace,
	Overview,
	RetainedService,
	Resource,
	SpanLink,
	TraceTree,
	TracesRequest,
	SpanFacts,
	SpanFailure
} from '#services/telemetry/schema.ts'

// A GitHub repository's full name, as GitHub Actions runs are stored under.
const REPOSITORY = /^[A-Za-z\d][A-Za-z\d-]{0,38}\/[\w.-]{1,100}$/u

const byStart = Order.mapInput(DateTime.Order, (span: Pick<Span, 'start'>) => span.start)

// An OTLP attribute's one primitive value, unwrapped; an integer past what a number holds exactly stays the string OTLP sent.
function primitiveOf(value: unknown) {
	if (Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)) return Option.some(value)
	if (value === null || !Predicate.isObject(value) || Array.isArray(value)) return Option.none<Schema.Json>()
	const integer = value['intValue']
	if (Predicate.isNumber(integer)) return Option.some(integer)
	if (Predicate.isString(integer)) {
		return Option.some(
			pipe(
				Number.parse(integer),
				Option.filter(parsed => Math.abs(parsed) <= 2 ** 53 - 1),
				Option.getOrElse(() => integer)
			)
		)
	}
	const double = value['doubleValue']
	if (Predicate.isNumber(double)) return Option.some(double)
	const bool = value['boolValue']
	if (Predicate.isBoolean(bool)) return Option.some(bool)
	const string = value['stringValue']
	if (Predicate.isString(string)) return Option.some(string)
	return Option.none<Schema.Json>()
}

// OTLP's attribute list as one object, each primitive unwrapped; an array or map keeps the shape OTLP sent.
function attributesOf(attributes: readonly Attribute[]) {
	return Record.fromIterableWith(
		attributes,
		attribute => [attribute.key, Option.getOrElse(primitiveOf(attribute.value), () => attribute.value)] as const
	)
}

function textOf(attributes: Attributes, key: string) {
	return pipe(attributes, Record.get(key), Option.filter(Predicate.isString))
}

function resourceText(resource: Option.Option<Resource>, key: string) {
	return pipe(
		resource,
		Option.flatMap(value => value.attributes),
		Option.map(attributesOf),
		Option.flatMap(attributes => textOf(attributes, key))
	)
}

// Effect names an HTTP span by its method alone: its route, or a client's path, says which request it was; unrouted server hits, mostly scanners, share one name. A machine step is named for its source.
function spanName(span: ExportedSpan, attributes: Attributes) {
	const name = Option.getOrElse(span.name, Function.constant(''))
	if (name === '') return name
	if (name === 'Machine.invoke') {
		return pipe(
			textOf(attributes, 'machine.invoke.source'),
			Option.filter(String.isNonEmpty),
			Option.match({onNone: () => name, onSome: source => `Machine.invoke ${source}`})
		)
	}
	if (!Option.contains(textOf(attributes, 'http.request.method'), name)) return name
	return pipe(
		textOf(attributes, 'http.route'),
		Option.filter(String.isNonEmpty),
		Option.match({
			onNone: () => {
				// OTLP's SpanKind 2 is a server answering a request.
				if (Option.contains(span.kind, 2)) return `${name} (no route)`
				return pipe(
					textOf(attributes, 'url.path'),
					Option.filter(String.isNonEmpty),
					Option.match({onNone: () => name, onSome: path => `${name} ${path}`})
				)
			},
			onSome: route => `${name} ${route}`
		})
	)
}

export function appName(service: ServiceName) {
	return AppName.make(pipe(service, String.replace(/^@deslop\//u, ''), String.replace(/-(?:server|client|ios)$/u, '')))
}

// The tool's side: the resource's runtime, else the suffix its service name already carries; unknown names omit it.
export function sideOf(service: ServiceName | AppName, value: Runtime) {
	if (Schema.is(Side)(value)) return Option.some(value)
	if (String.endsWith('-server')(service)) return Option.some('server' as const)
	if (String.endsWith('-client')(service)) return Option.some('web' as const)
	if (String.endsWith('-ios')(service)) return Option.some('mobile' as const)
	return Option.none<Side>()
}

// The stored encoding truncates epoch nanoseconds to microseconds, then represents them as fractional milliseconds.
function instantOf(nanos: Duration.Duration) {
	return DateTime.mapEpochMillis(DateTime.makeUnsafe(0), () =>
		Duration.toMillis(Duration.micros(Duration.toNanosUnsafe(nanos) / 1000n))
	)
}

// Who sent a record: its service, the side it runs on, the run its process started and the release it built.
export function senderOf(resource: Option.Option<Resource>) {
	return {
		run: pipe(
			resourceText(resource, 'scope.run.started_unix_nano'),
			Option.flatMap(Schema.decodeOption(Nano)),
			Option.map(instantOf),
			Option.map(DateTime.startOf('millisecond'))
		),
		runtime: pipe(
			resourceText(resource, 'scope.runtime'),
			Option.filter(Schema.is(Runtime)),
			Option.getOrElse(Function.constant('unknown' as const))
		),
		service: ServiceName.make(
			pipe(
				resourceText(resource, 'service.name'),
				Option.filter(String.isNonEmpty),
				Option.getOrElse(Function.constant('unknown'))
			)
		),
		version: pipe(
			resourceText(resource, 'service.version'),
			Option.filter(String.isNonEmpty),
			Option.map(version => ReleaseVersion.make(version))
		)
	}
}

// The sender an export may write as, or none: only GitHub's signed webhook writes under a repository's name, and an anonymous `ci` runtime is not shown as CI.
export function admittedSender(sender: ReturnType<typeof senderOf>, origin: Origin) {
	if (origin === 'github') return Option.some(sender)
	if (Option.isSome(String.match(REPOSITORY)(sender.service))) return Option.none()
	if (origin === 'anonymous' && sender.runtime === 'ci') return Option.some({...sender, runtime: 'unknown' as const})
	return Option.some(sender)
}

// A time more than ten minutes past its receipt comes from a wrong clock, so the record happened when it arrived.
export function receivedBy(time: DateTime.Utc, receivedAt: DateTime.Utc) {
	if (DateTime.isGreaterThan(time, DateTime.addDuration(receivedAt, Duration.minutes(10)))) return receivedAt
	return time
}

// Primitive leaf values of an OTLP body, without object keys: Effect logs send an array of arguments.
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
		onEmpty: Function.constFalse,
		onNonEmpty: found =>
			Array.every(found, exception => Option.contains(textOf(exception, 'exception.type'), 'AuthError'))
	})
}

// The rows an OTLP traces export stores: one per span its origin may write, and one per link into another trace; the spans it may not write are counted.
export function spansOf(payload: TracesRequest, origin: Origin, receivedAt: DateTime.Utc) {
	const groups = pipe(
		payload.resourceSpans,
		Option.getOrElse(Array.empty),
		Array.map(group => ({
			// All spans in the group share one sender, regardless of instrumentation scope.
			sender: admittedSender(senderOf(group.resource), origin),
			spans: pipe(
				group.scopeSpans,
				Option.getOrElse(() => []),
				Array.flatMap(scope => Option.getOrElse(scope.spans, () => []))
			)
		}))
	)
	const spans = Array.flatMap(groups, group =>
		Option.match(group.sender, {
			onNone: () => [],
			onSome: sender =>
				Array.map(group.spans, span => {
					const attributes = attributesOf(Option.getOrElse(span.attributes, Array.empty))
					const exceptions = Option.match(span.events, {
						onNone: () => [],
						onSome: events =>
							pipe(
								events,
								Array.filter(event => event.name === 'exception'),
								Array.map(event => attributesOf(Option.getOrElse(event.attributes, () => [])))
							)
					})
					const failed = Option.exists(span.status, status => Option.contains(status.code, 2))
					const traceId = TraceId.make(String.toLowerCase(span.traceId))
					const spanId = SpanId.make(String.toLowerCase(span.spanId))
					return {
						links: pipe(
							span.links,
							Option.getOrElse(() => []),
							Array.flatMap(link =>
								Boolean.match(String.toLowerCase(link.traceId) === traceId, {
									onFalse: () => [
										{
											linkedSpanId: SpanId.make(String.toLowerCase(link.spanId)),
											linkedTraceId: TraceId.make(String.toLowerCase(link.traceId)),
											spanId,
											traceId
										}
									],
									onTrue: () => []
								})
							)
						),
						span: {
							...sender,
							attributes,
							// Subtract before rounding the start so short spans at modern epochs retain their duration.
							duration: Option.map(span.endTimeUnixNano, end =>
								pipe(
									Duration.subtract(end, span.startTimeUnixNano),
									Duration.max(Duration.zero),
									Duration.toMillis,
									Duration.millis
								)
							),
							error: pipe(
								span.status,
								Option.flatMap(status => status.message),
								Option.filter(Predicate.isString),
								Option.filter(message => failed && String.isNonEmpty(message))
							),
							exception: pipe(
								Array.head(exceptions),
								Option.flatMap(exception => textOf(exception, 'exception.message')),
								Option.filter(String.isNonEmpty)
							),
							name: spanName(span, attributes),
							parentSpanId: Option.map(span.parentSpanId, id => SpanId.make(String.toLowerCase(id))),
							spanId,
							start: receivedBy(instantOf(span.startTimeUnixNano), receivedAt),
							status: Boolean.match(failed, {
								onFalse: Function.constant('ok' as const),
								onTrue: () =>
									Boolean.match(deniedSpan(attributes, exceptions), {
										onFalse: Function.constant('failed' as const),
										onTrue: Function.constant('denied' as const)
									})
							}),
							traceId
						} satisfies Span
					}
				})
		})
	)
	const latest = Record.values(Record.fromIterableBy(spans, item => `${item.span.traceId}:${item.span.spanId}`))
	return {
		links: Array.flatMap(latest, item => item.links),
		rejected: pipe(
			groups,
			Array.filter(group => Option.isNone(group.sender)),
			Array.map(group => group.spans.length),
			Number.sumAll
		),
		spans: Array.map(latest, item => item.span)
	}
}

// A severity as OTLP's number; a record with only a text level maps onto the same scale.
function severityOf(number: Option.Option<number>, text: Option.Option<string>) {
	return Option.getOrElse(number, () => {
		const level = Option.map(text, String.toUpperCase)
		if (Option.exists(level, value => value === 'FATAL' || value === 'ERROR')) return 17
		if (Option.contains(level, 'WARN')) return 13
		if (Option.contains(level, 'INFO')) return 9
		if (Option.contains(level, 'DEBUG')) return 5
		return 0
	})
}

// One log record of an OTLP logs export, under the identity its digest gave it.
export function logOf(sender: ReturnType<typeof senderOf>, log: ExportedLog, id: LogId, receivedAt: DateTime.Utc) {
	return {
		...sender,
		attributes: attributesOf(Option.getOrElse(log.attributes, Array.empty)),
		id,
		message: Option.match(log.body, {onNone: Function.constant(''), onSome: body => Array.join(leaves(body), ' ')}),
		receivedAt,
		severity: severityOf(log.severityNumber, log.severityText),
		spanId: Option.map(log.spanId, value => SpanId.make(String.toLowerCase(value))),
		// A record without an event time happened when it was observed, else when its export arrived.
		time: pipe(
			Option.filter(log.timeUnixNano, Duration.isPositive),
			Option.orElse(() => Option.filter(log.observedTimeUnixNano, Duration.isPositive)),
			Option.match({onNone: () => receivedAt, onSome: nanos => receivedBy(instantOf(nanos), receivedAt)})
		),
		traceId: Option.map(log.traceId, value => TraceId.make(String.toLowerCase(value)))
	} satisfies Log
}

export function levelOf(severity: number) {
	if (severity >= 17) return 'error'
	if (severity >= 13) return 'warn'
	if (severity >= 9) return 'info'
	if (severity >= 5) return 'debug'
	return 'trace'
}

// The diagnostic a failed span is remembered by: its exception's message or its status line, first line only, no stack trace.
export function diagnosis(span: SpanFailure) {
	return pipe(
		span.exception,
		Option.orElse(() => span.error),
		Option.map(message => pipe(message, String.split('\n'), Array.headNonEmpty, String.trim, String.slice(0, 300))),
		Option.filter(String.isNonEmpty)
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
	return Option.liftPredicate(Record.fromEntries(entries), () => Array.isReadonlyArrayNonEmpty(entries))
}

// How long a span ran; an open one has run no time yet.
function spanDuration(span: Pick<Span, 'duration'>) {
	return Option.getOrElse(span.duration, () => Duration.zero)
}

// Effect marks every span a failure passed through as failed, so where it broke is the failed span with no failed child.
function brokeAt<A extends SpanFacts>(spans: readonly A[]) {
	const failedSpans = Array.filter(spans, span => span.status === 'failed')
	const parents = HashSet.fromIterable(
		Array.getSomes(Array.map(failedSpans, span => Option.map(span.parentSpanId, parent => `${span.traceId}:${parent}`)))
	)
	return pipe(
		failedSpans,
		Array.filter(span => !HashSet.has(parents, `${span.traceId}:${span.spanId}`)),
		Array.match({
			onEmpty: () => Option.none<A>(),
			onNonEmpty: candidates => Option.some(Array.min(candidates, byStart))
		})
	)
}

// The span a trace starts from: one whose parent the trace doesn't hold, one sent without a parent before one whose parent is missing, the earliest if a skewed clock leaves several.
function traceRoot<A extends SpanFacts>(spans: Array.NonEmptyReadonlyArray<A>) {
	const ids = HashSet.fromIterable(Array.map(spans, span => span.spanId))
	const candidates = pipe(
		spans,
		Array.filter(span => !Option.exists(span.parentSpanId, parent => HashSet.has(ids, parent))),
		Array.match({onEmpty: () => spans, onNonEmpty: Function.identity})
	)
	return pipe(
		candidates,
		Array.filter(span => Option.isNone(span.parentSpanId)),
		Array.match({onEmpty: () => candidates, onNonEmpty: Function.identity}),
		Array.min<A>(byStart)
	)
}

// A trace's start and length, without assembling its tree.
function timingOf(spans: Array.NonEmptyReadonlyArray<SpanFacts>) {
	const start = pipe(
		spans,
		Array.map(span => span.start),
		Array.min<DateTime.Utc>(DateTime.Order)
	)
	return {
		durationMs: Array.reduce(spans, Duration.zero, (end, span) =>
			pipe(DateTime.distance(start, span.start), Duration.sum(spanDuration(span)), Duration.max(end))
		),
		start
	}
}

// Each linked trace's root hangs under the span it links to, its own link first.
function linkedParents(spans: readonly Span[], links: readonly SpanLink[]) {
	const ids = HashSet.fromIterable(Array.map(spans, span => `${span.traceId}:${span.spanId}`))
	const linksOf = Array.groupBy(links, link => `${link.traceId}:${link.spanId}`)
	return Record.fromEntries(
		Array.flatMap(Record.values(Array.groupBy(spans, span => span.traceId)), group => {
			const root = traceRoot(group)
			return pipe(
				[root, ...group],
				Array.findFirst(span =>
					pipe(
						linksOf,
						Record.get(`${span.traceId}:${span.spanId}`),
						Option.flatMap(Option.fromUndefinedOr),
						Option.getOrElse(Array.empty<SpanLink>),
						Array.findFirst(link => HashSet.has(ids, `${link.linkedTraceId}:${link.linkedSpanId}`))
					)
				),
				Option.match({
					onNone: () => [],
					onSome: link => [[`${root.traceId}:${root.spanId}`, `${link.linkedTraceId}:${link.linkedSpanId}`] as const]
				})
			)
		})
	)
}

// The spans a tree walk has still to visit, first on top.
type Pending = Option.Option<{readonly depth: number; readonly node: TreeNode; readonly rest: Pending}>

// A span in start order, with the span it hangs under when the trace holds it.
type TreeNode = {
	readonly index: number
	readonly parent: Option.Option<{readonly index: number; readonly span: Span}>
	readonly span: Span
}

function pendingOf(steps: readonly {depth: number; node: TreeNode}[], rest: Pending) {
	return Array.reduceRight(steps, rest, (tail, step) => Option.some({...step, rest: tail}))
}

// A trace and the traces its links join, as one tree in start order with each span's logs beside it.
export function traceTree(id: TraceId, spans: readonly Span[], logs: readonly Log[], links: readonly SpanLink[]) {
	const ordered = Array.sort(spans, byStart)
	const indexed = Array.map(ordered, (span, index) => ({index, span}))
	const byId = Record.fromIterableBy(indexed, item => `${item.span.traceId}:${item.span.spanId}`)
	const linked = linkedParents(ordered, links)
	function parentOf(span: Span) {
		return pipe(
			linked,
			Record.get(`${span.traceId}:${span.spanId}`),
			Option.orElse(() => Option.map(span.parentSpanId, parent => `${span.traceId}:${parent}`))
		)
	}
	const sortedLogs = Array.sort(
		logs,
		Order.mapInput(DateTime.Order, (log: Log) => log.time)
	)
	const timing = Array.match(ordered, {
		onEmpty: () => ({durationMs: Duration.zero, start: Option.map(Array.head(sortedLogs), log => log.time)}),
		onNonEmpty: retained => {
			const bounds = timingOf(retained)
			return {...bounds, start: Option.some(bounds.start)}
		}
	})
	const bySpan = pipe(
		sortedLogs,
		Array.map(log =>
			Option.map(Option.all({spanId: log.spanId, traceId: log.traceId}), ids => ({
				log,
				spanId: `${ids.traceId}:${ids.spanId}`
			}))
		),
		Array.getSomes,
		Array.groupBy(entry => entry.spanId),
		Record.map(entries => Array.map(entries, entry => entry.log))
	)
	const nodes = Array.map(
		indexed,
		item =>
			({
				...item,
				parent: pipe(
					parentOf(item.span),
					Option.flatMap(parent => Record.get(byId, parent)),
					Option.filter(parent => parent.index !== item.index)
				)
			}) satisfies TreeNode
	)
	const children = pipe(
		nodes,
		Array.flatMap(node => Option.toArray(Option.map(node.parent, parent => ({child: node, parent: parent.index})))),
		Array.groupBy(entry => `${entry.parent}`)
	)
	// One walk from the roots in start order, each span's children after it; a span whose parents loop through links starts its own branch.
	const walk = Array.getSomes(
		Array.unfold<{pending: Pending; seen: HashSet.HashSet<number>}, Option.Option<{depth: number; node: TreeNode}>>(
			{
				pending: pendingOf(
					Array.map([...Array.filter(nodes, node => Option.isNone(node.parent)), ...nodes], node => ({depth: 0, node})),
					Option.none()
				),
				seen: HashSet.empty<number>()
			},
			state =>
				Option.map(state.pending, top => {
					if (HashSet.has(state.seen, top.node.index)) return [Option.none(), {...state, pending: top.rest}] as const
					const next = pipe(
						children,
						Record.get(`${top.node.index}`),
						Option.getOrElse(() => []),
						Array.map(entry => ({depth: top.depth + 1, node: entry.child}))
					)
					return [
						Option.some(top),
						{pending: pendingOf(next, top.rest), seen: HashSet.add(state.seen, top.node.index)}
					] as const
				})
		)
	)
	const tree = Array.flatMap(Option.toArray(timing.start), start =>
		Array.map(walk, step => ({
			...Struct.pick(step.node.span, Struct.keys(Span.fields)),
			depth: step.depth,
			durationMs: spanDuration(step.node.span),
			logs: pipe(
				bySpan,
				Record.get(`${step.node.span.traceId}:${step.node.span.spanId}`),
				Option.getOrElse(Array.empty)
			),
			offsetMs: DateTime.distance(start, step.node.span.start),
			parentSpanId: Option.map(step.node.parent, parent => parent.span.spanId)
		}))
	)
	return {
		durationMs: timing.durationMs,
		failureSpanId: Option.map(brokeAt(ordered), span => span.spanId),
		id,
		logs: Array.filter(
			sortedLogs,
			log =>
				!Option.exists(Option.all({spanId: log.spanId, traceId: log.traceId}), ids =>
					Record.has(byId, `${ids.traceId}:${ids.spanId}`)
				)
		),
		spans: tree
	} satisfies TraceTree
}

// Apps with failures lead, then the busiest; each app's operations count only the traces started in the page's time frame, so a quiet app keeps its tab with no rows.
export function overviewOf(
	traces: readonly (CountedOperation & {traces: Array.NonEmptyReadonlyArray<OperationTrace>})[],
	services: readonly RetainedService[]
) {
	const operations = pipe(
		traces,
		Array.groupBy(item => item.app),
		Record.map(group =>
			pipe(
				group,
				Array.sort(
					pipe(
						Order.flip(Order.Boolean),
						Order.mapInput((item: CountedOperation) => item.failures > 0),
						Order.combine(Order.mapInput(Order.flip(DateTime.Order), (item: CountedOperation) => item.latest))
					)
				),
				Array.map(item => Struct.omit(item, ['app', 'latest']))
			)
		)
	)
	return {
		apps: pipe(
			Record.values(Array.groupBy(services, item => appName(item.service))),
			Array.map(group => ({
				ci: Option.some(Array.every(group, item => item.ci)),
				count: Number.sumAll(Array.map(group, item => item.count)),
				failures: Number.sumAll(Array.map(group, item => item.failures)),
				name: appName(Array.headNonEmpty(group).service)
			})),
			Array.sort(
				pipe(
					Order.flip(Order.Number),
					Order.mapInput((app: {failures: number; count: number}) => app.failures),
					Order.combine(Order.mapInput(Order.flip(Order.Number), (app: {failures: number; count: number}) => app.count))
				)
			),
			Array.map(app => ({
				ci: app.ci,
				name: app.name,
				operations: pipe(
					operations,
					Record.get(app.name),
					Option.getOrElse(() => [])
				)
			}))
		)
	} satisfies Overview
}
