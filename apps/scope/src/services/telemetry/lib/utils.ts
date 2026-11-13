import {
	Array,
	Boolean,
	DateTime,
	Function,
	HashMap,
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

import {Nano, rangeStart, Runtime, Side, SpanLink} from '#services/telemetry/schema.ts'
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

const EMPTY_ENTRIES = Array.empty<Entry>()

// Releases compare part by part as numbers, so 0.1.1235 is newer than 0.1.999.
const byRelease = Order.mapInput(Order.Array(Order.Number), (version: string) =>
	Array.map(String.split(version, '.'), part => Option.getOrElse(Number.parse(part), () => 0))
)

type StoredAttribute = {key: string; value: unknown}

function resourceString(resource: {readonly attributes?: readonly StoredAttribute[]}, key: string) {
	return pipe(
		resource.attributes ?? [],
		Array.findFirst(attribute => attribute.key === key),
		Option.flatMap(attribute => Option.liftPredicate(attribute.value, Predicate.isObject)),
		Option.flatMap(value => Option.liftPredicate(value['stringValue'], String.isString)),
		Option.getOrElse(() => '')
	)
}

// Stored payloads already hold OTLP attributes, so a lookup reads them instead of decoding the array on every span and snapshot.
function spanAttributes(payload: Schema.JsonObject) {
	const attributes = payload['attributes']
	if (!Array.isArray(attributes)) return []
	const found = Array.map(attributes, attribute =>
		Option.flatMap(Option.liftPredicate(attribute, Predicate.isObject), object =>
			Option.all({
				key: Option.liftPredicate(object['key'], Predicate.isString),
				value: Option.liftPredicate(object['value'], Predicate.isObject)
			})
		)
	)
	if (Array.some(found, Option.isNone)) return []
	return Array.getSomes(found)
}

// An OTLP attribute's one primitive value: a string, number or boolean, wrapped as the protocol sends it.
function primitiveOf(value: unknown) {
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

function attributePrimitive(attributes: readonly StoredAttribute[], key: string) {
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

// A trace is dropped only when it has versioned entries and every one of them is old.
function groupSuperseded(group: readonly Entry[], newest: Record<string, string>) {
	if (Array.some(group, entry => releaseOf(entry) === '')) return false
	const versioned = Array.filter(group, entry => releaseOf(entry) !== '')
	if (Array.isReadonlyArrayEmpty(versioned)) return false
	return Array.every(versioned, entry => isSuperseded(entry, newest))
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
	const cutoff = receivedAt - retentionMs
	const entries = Array.fromIterable(HashMap.values(current))
	function expiredOne(entry: Entry) {
		return entry.receivedAt < cutoff
	}
	// Expiry is whole-trace: when one entry outlives retention, its siblings go too. A release is too: keep the trace while any versioned entry is current or an unversioned sibling is present.
	const traces = HashSet.union(
		HashSet.fromIterable(
			Array.map(
				Array.filter(entries, entry => entry.traceId !== '' && expiredOne(entry)),
				entry => entry.traceId
			)
		),
		HashSet.fromIterable(
			Array.getSomes(
				Array.map(
					Record.values(
						Array.groupBy(
							Array.filter(entries, entry => entry.traceId !== ''),
							entry => entry.traceId
						)
					),
					group =>
						Boolean.match(groupSuperseded(group, newest), {
							onFalse: () => Option.none<string>(),
							onTrue: () => Option.some(Array.headNonEmpty(group).traceId)
						})
				)
			)
		)
	)
	const expired = Array.filter(entries, entry =>
		pruned(entry, traces, candidate => expiredOne(candidate) || isSuperseded(candidate, newest))
	)
	return {expired, next: Array.reduce(expired, current, (all, entry) => HashMap.remove(all, entry.id))}
}

// Save touches the traces it receives and, when a service's newest release moved, only that service's stored entries.
export function reconcileReleases(
	entriesOf: (traceId: string) => readonly Entry[],
	entriesOfService: (service: string) => readonly Entry[],
	incoming: Entry[],
	known: Record<string, string>
) {
	const newest = newestVersions(incoming, known)
	const groups = Array.groupBy(
		Array.filter(incoming, entry => entry.traceId !== ''),
		entry => entry.traceId
	)
	const changedEntries = Array.flatMap(
		Array.filter(
			Array.dedupe(Array.map(incoming, entry => entry.service)),
			service =>
				Option.getOrUndefined(Record.get(known, service)) !== Option.getOrUndefined(Record.get(newest, service))
		),
		(service: string) => entriesOfService(service)
	)
	const touched = HashSet.union(
		HashSet.fromIterable(Record.keys(groups)),
		HashSet.fromIterable(
			Array.flatMap(changedEntries, entry =>
				Boolean.match(entry.traceId === '', {onFalse: () => [entry.traceId], onTrue: () => []})
			)
		)
	)
	const outcomes = Array.map(Array.fromIterable(touched), traceId => {
		const current = entriesOf(traceId)
		const batch = Option.getOrElse(Record.get(groups, traceId), () => EMPTY_ENTRIES)
		if (groupSuperseded([...current, ...batch], newest)) return {accepted: EMPTY_ENTRIES, replaced: current}
		return {accepted: batch, replaced: EMPTY_ENTRIES}
	})
	return {
		accepted: [
			...Array.filter(incoming, entry => entry.traceId === '' && !isSuperseded(entry, newest)),
			...Array.flatMap(outcomes, outcome => outcome.accepted)
		],
		newest,
		replaced: [
			...Array.filter(changedEntries, entry => entry.traceId === '' && isSuperseded(entry, newest)),
			...Array.flatMap(outcomes, outcome => outcome.replaced)
		]
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
export function failedEntry(entry: Pick<Entry, 'denied' | 'status'>) {
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
			attribute.key === 'server.port' ||
			// `url.full` already holds the path, query and host.
			attribute.key === 'url.path' ||
			attribute.key === 'url.query' ||
			attribute.key === 'server.address'
		) {
			return []
		}
		if (String.startsWith('code.')(attribute.key)) return []
		if (attribute.key === 'http.request.method' && String.startsWith(`${value}`)(name)) return []
		if (attribute.key === 'client.address' && (value === '127.0.0.1' || value === '::1')) return []
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

// Each service's latest run counted in one pass; the first entry of the newest run names its runtime and release.
export function serviceStatuses(entries: Entry[]) {
	type Run = {count: number; lastEventAt: string; latest: Entry; run: bigint; service: string}
	const runs: Record<string, Run> = {}
	for (const entry of entries) {
		const run = started(entry.resource)
		const current = runs[entry.service]
		if (current === undefined) {
			runs[entry.service] = {count: 1, lastEventAt: entry.time, latest: entry, run, service: entry.service}
		} else if (run > current.run) {
			current.count = 1
			current.lastEventAt = entry.time
			current.latest = entry
			current.run = run
		} else if (run === current.run) {
			current.count += 1
			if (BigInt(entry.time) > BigInt(current.lastEventAt)) current.lastEventAt = entry.time
		}
	}
	return Array.map(Record.values(runs), current => ({
		entries: current.count,
		lastEventAt: current.lastEventAt,
		name: current.service,
		runStartedAt: `${current.run}`,
		runtime: runtime(current.latest.resource),
		version: versionOf(current.latest)
	})) satisfies ServiceStatus[]
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
	const failedSpans = Array.filter(spans, failedEntry)
	const parents = HashSet.fromIterable(Array.map(failedSpans, parentId))
	return Array.match(
		Array.filter(failedSpans, span => !HashSet.has(parents, span.spanId)),
		{onEmpty: () => Option.none(), onNonEmpty: candidates => Option.some(Array.min(candidates, byStart))}
	)
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

export function readLinks(payload: Schema.JsonObject) {
	return Option.getOrElse(Schema.decodeUnknownOption(Schema.Array(SpanLink))(payload['links']), () => [] as const)
}

function reached(
	edges: readonly {from: string; to: string}[],
	found: HashSet.HashSet<string>
): HashSet.HashSet<string> {
	const next = Array.dedupe(
		Array.flatMap(edges, edge => {
			if (HashSet.has(found, edge.from) && !HashSet.has(found, edge.to)) return [edge.to]
			if (HashSet.has(found, edge.to) && !HashSet.has(found, edge.from)) return [edge.from]
			return []
		})
	)
	if (!Array.isReadonlyArrayNonEmpty(next)) return found
	return reached(edges, HashSet.union(found, HashSet.fromIterable(next)))
}

// The trace and every trace a span link joins to it, either way, so the work a request started reads as part of it.
export function linkedTraces(entries: readonly Entry[], id: string) {
	return reached(
		Array.flatMap(entries, entry =>
			Array.flatMap(entry.links ?? [], link => {
				if (link.traceId === entry.traceId) return []
				return [{from: entry.traceId, to: link.traceId}]
			})
		),
		HashSet.make(id)
	)
}

// Each linked trace's root hangs under the span it links to, its own link first.
function linkedParents(spans: readonly Entry[]) {
	const ids = HashSet.fromIterable(Array.map(spans, span => span.spanId))
	return Record.fromEntries(
		Array.flatMap(Record.values(Array.groupBy(spans, span => span.traceId)), group => {
			const root = traceRoot(group)
			return Option.match(
				Array.findFirst([root, ...group], span =>
					Array.findFirst(span.links ?? [], link => link.traceId !== span.traceId && HashSet.has(ids, link.spanId))
				),
				{onNone: () => [], onSome: link => [[root.spanId, link.spanId] as const]}
			)
		})
	)
}

export function traceView(entries: Entry[], id: string) {
	const traces = linkedTraces(entries, id)
	const records = Array.filter(entries, entry => HashSet.has(traces, entry.traceId))
	const ordered = Array.sort(records, byStart)
	const spans = Array.map(
		Array.filter(ordered, entry => entry.signal === 'trace'),
		(entry, index) => ({entry, index})
	)
	const byId = Record.fromEntries(Array.map(spans, span => [span.entry.spanId, span] as const))
	const linked = linkedParents(Array.map(spans, span => span.entry))
	function parentOf(entry: Entry) {
		return Option.getOrElse(Record.get(linked, entry.spanId), () => parentId(entry))
	}
	const timing = traceTiming(records)
	const logs = Array.filter(ordered, entry => entry.signal === 'log')
	const bySpan = Array.groupBy(logs, log => log.spanId)

	const broken = brokeAt(Array.map(spans, span => span.entry))
	const tree = pipe(
		Array.map(spans, span => {
			const ancestors = Array.reverse(
				Array.unfold({entry: span.entry, seen: HashSet.make(span.entry.spanId)}, current =>
					pipe(
						Record.get(byId, parentOf(current.entry)),
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
					...Struct.omit(span.entry, ['links']),
					depth: ancestors.length,
					logs: Option.getOrElse(Record.get(bySpan, span.entry.spanId), () => []),
					offsetMs: durationMs(timing.time, span.entry.time),
					parentSpanId: parentOf(span.entry),
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

export type Traced = {app: string; name: string; runtime: Runtime; trace: OperationTrace}

export function markedStream(entry: Entry) {
	return Array.some(
		spanAttributes(entry.payload),
		attribute => attribute.key === 'rpc.stream' && primitiveOf(attribute.value) === true
	)
}

// A subscription's lifetime is not action latency. A nested subscription does not turn its owning action into one.
export function subscription(root: Entry, spans: readonly Entry[]) {
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
export function machineTimer(root: Entry) {
	return (
		root.payload['name'] === 'Machine.invoke' &&
		Option.getOrUndefined(attributePrimitive(spanAttributes(root.payload), 'machine.invoke.kind')) === 'Timer'
	)
}

function failureCount(group: readonly Traced[]) {
	return Array.countBy(group, item => item.trace.failure !== undefined)
}

// A trace is a row once its root has arrived, since children export first; one whose root never comes shows after a minute.
export function tracedTrace(records: readonly Entry[], now: number) {
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
							attribute =>
								Option.flatMap(Option.liftPredicate(attribute.value, Predicate.isObject), value =>
									Option.liftPredicate(value['stringValue'], String.isString)
								)
						),
						{onNone: () => ({}), onSome: label => ({label})}
					),
					time: timing.time
				}
			} satisfies Traced)
		}
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
