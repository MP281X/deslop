import {
	Array,
	Boolean,
	Duration,
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

import {Attribute, Nano, Runtime} from '#services/telemetry/schema.ts'
import type {
	Entry,
	Filters,
	Operation,
	OperationTrace,
	Overview,
	Query,
	Resource,
	Stats,
	Trace
} from '#services/telemetry/schema.ts'

// Each operation lists this many traces, its newest failures among them.
const KEEP = 20

// Releases compare part by part as numbers, so 0.1.1235 is newer than 0.1.999.
const byRelease = Order.mapInput(Order.Array(Order.Number), (version: string) =>
	Array.map(String.split(version, '.'), part => Option.getOrElse(Number.parse(part), () => 0))
)

export function queryOf(filters: Filters & Partial<Pick<Query, 'limit' | 'offset' | 'sort'>>, now: number) {
	return {
		limit: 1000,
		offset: 0,
		sort: 'recent' as const,
		...filters,
		from: now - Duration.toMillis(filters.since),
		to: now
	}
}

function resourceString(resource: {readonly attributes?: readonly Attribute[]}, key: string) {
	return pipe(
		resource.attributes ?? [],
		Array.findFirst(attribute => attribute.key === key),
		Option.flatMap(attribute => Option.liftPredicate(attribute.value['stringValue'], String.isString)),
		Option.getOrElse(() => '')
	)
}

// Effect names an HTTP span by its method alone: its route, or a client's path, says which request it was; unrouted server hits, mostly scanners, share one name.
export function spanName(span: Schema.JsonObject) {
	const name = Option.getOrElse(Option.liftPredicate(span['name'], String.isString), () => '')
	const attributes = {
		attributes: Option.getOrElse(Schema.decodeUnknownOption(Schema.Array(Attribute))(span['attributes']), () => [])
	}
	if (name === '' || name !== resourceString(attributes, 'http.request.method')) return name
	const route = resourceString(attributes, 'http.route')
	if (String.isNonEmpty(route)) return `${name} ${route}`
	// OTLP's SpanKind 2 is a server answering a request.
	if (span['kind'] === 2) return `${name} (no route)`
	return pipe(
		Option.liftPredicate(resourceString(attributes, 'url.path'), String.isNonEmpty),
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
	const expired = Array.filter(entries, entry => {
		const received = Option.match(Option.fromUndefinedOr(entry.receivedAt), {
			onNone: () => BigInt(entry.time),
			onSome: time => BigInt(time) * 1_000_000n
		})
		return received < cutoff || isSuperseded(entry, newest)
	})
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
	const accepted = Array.filter(entries, entry => !isSuperseded(entry, newest))
	const replaced = Array.filter(
		Boolean.match(Record.isEmptyRecord(Record.filter(newest, (latest, name) => known[name] !== latest)), {
			onFalse: () => Array.fromIterable(HashMap.values(current)),
			onTrue: () => []
		}),
		entry => isSuperseded(entry, newest)
	)
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

function latestEntry(entries: Array.NonEmptyReadonlyArray<Entry>, run: (entry: Entry) => bigint) {
	return Array.max(entries, Order.mapInput(Order.BigInt, run))
}

export function currentEntries(entries: Entry[]) {
	const run = runsOf(entries)
	const latest = Record.map(
		Array.groupBy(entries, entry => entry.service),
		group => run(latestEntry(group, run))
	)
	const stale = HashSet.fromIterable(
		Array.map(
			Array.filter(entries, entry => entry.traceId !== '' && run(entry) < (latest[entry.service] ?? 0n)),
			entry => entry.traceId
		)
	)
	return Array.filter(
		entries,
		entry => run(entry) === (latest[entry.service] ?? 0n) && !HashSet.has(stale, entry.traceId)
	)
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

export function summary(entries: Entry[], query: Query) {
	const times = Array.sort(
		Array.map(entries, entry => entry.durationMs),
		Order.Number
	)
	return {
		count: entries.length,
		errors: Array.countBy(entries, entry => entry.status === 2),
		from: query.from,
		maxMs: percentile(times, 1),
		p50Ms: percentile(times, 0.5),
		p95Ms: percentile(times, 0.95),
		to: query.to
	} satisfies Stats
}

export function filterEntries(entries: Entry[], query: Query, signal: Entry['signal'] | 'all') {
	const text = String.toLowerCase(query.text)
	const traceId = String.toLowerCase(query.traceId)
	return Array.filter(entries, entry => {
		const milliseconds = pipe(Number.parse(`${BigInt(entry.time) / 1_000_000n}`), Option.getOrThrow)
		return (
			(signal === 'all' || entry.signal === signal) &&
			milliseconds >= query.from &&
			milliseconds <= query.to &&
			(query.service === '' || entry.service === query.service) &&
			(query.operation === '' || entry.name === query.operation) &&
			(traceId === '' || entry.traceId === traceId) &&
			(!query.errors || entry.status === 2) &&
			// Text searches the span name or log message, attributes, status and events, not ids, times or the resource.
			(text === '' ||
				String.includes(text)(
					String.toLowerCase(
						Array.join(
							[entry.name, ...leaves(Struct.pick(entry.payload, ['attributes', 'body', 'events', 'status']))],
							' '
						)
					)
				))
		)
	})
}

// OTLP timestamps are nanoseconds since the epoch, so they compare exactly as BigInts.
const byTime = Order.mapInput(Order.BigInt, (time: string) => BigInt(time))

const byStart = Order.mapInput(byTime, (entry: {time: string}) => entry.time)

export function orderEntries<A extends {durationMs: number; time: string}>(entries: A[], sort: Query['sort']) {
	return Array.sort(
		entries,
		Boolean.match(sort === 'slowest', {
			onFalse: () => Order.flip(byStart),
			onTrue: () => Order.flip(Order.mapInput(Order.Number, (entry: A) => entry.durationMs))
		})
	)
}

export function serviceStatuses(entries: Entry[]) {
	const runOf = runsOf(entries)
	return Record.collect(
		Array.groupBy(entries, entry => entry.service),
		(name, group) => {
			const latest = latestEntry(group, runOf)
			const run = runOf(latest)
			const current = Array.filter(group, entry => runOf(entry) === run)
			return {
				entries: current.length,
				lastEventAt: Array.max(['0', ...Array.map(current, entry => entry.time)], byTime),
				name,
				runStartedAt: `${run}`,
				runtime: runtime(latest.resource),
				version: versionOf(latest)
			}
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
function brokeAt(spans: readonly Entry[]) {
	const failed = Array.filter(spans, span => span.status === 2)
	const parents = HashSet.fromIterable(Array.map(failed, parentId))
	return Array.match(
		Array.filter(failed, span => !HashSet.has(parents, span.spanId)),
		{onEmpty: () => Option.none(), onNonEmpty: candidates => Option.some(Array.min(candidates, byStart))}
	)
}

export function traceView(entries: Entry[], id: string) {
	const ordered = Array.reverse(orderEntries(entries, 'recent'))
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
function rootOf(spans: Array.NonEmptyReadonlyArray<Entry>) {
	const ids = HashSet.fromIterable(Array.map(spans, span => span.spanId))
	return Array.min(
		Array.match(
			Array.filter(spans, span => !HashSet.has(ids, parentId(span))),
			{onEmpty: () => spans, onNonEmpty: Function.identity}
		),
		byStart
	)
}

type Traced = {app: string; name: string; runtime: Runtime; trace: OperationTrace}

function spanAttributes(entry: Entry) {
	return Option.getOrElse(Schema.decodeUnknownOption(Schema.Array(Attribute))(entry.payload['attributes']), () => [])
}

function markedStream(entry: Entry) {
	return Array.some(
		spanAttributes(entry),
		attribute => attribute.key === 'rpc.stream' && attribute.value['boolValue'] === true
	)
}

// A subscription's lifetime is not action latency. A nested subscription does not turn its owning action into one.
function subscription(root: Entry, spans: readonly Entry[]) {
	if (markedStream(root)) return true
	const method = resourceString({attributes: spanAttributes(root)}, 'rpc.method')
	return Array.some(
		spans,
		span =>
			parentId(span) === root.spanId &&
			((root.name === 'POST /mcp' && String.includes('/subscriptions/listen')(span.name)) ||
				(method !== '' &&
					method === resourceString({attributes: spanAttributes(span)}, 'rpc.method') &&
					markedStream(span)))
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
			const root = rootOf(spans)
			if (subscription(root, spans)) return Option.none()
			return Option.some({
				app: appName(root.service),
				name: root.name,
				runtime: runtime(root.resource),
				trace: {
					durationMs: timing.durationMs,
					...Option.match(brokeAt(spans), {onNone: () => ({}), onSome: span => ({failure: {span: span.name}})}),
					id: root.traceId,
					time: timing.time
				}
			} satisfies Traced)
		}
	)
}

function operationsOf(group: readonly Traced[]) {
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

// Apps with failures lead, then the busiest.
export function overview(entries: readonly Entry[], now: number) {
	return {
		apps: Array.map(
			Array.sort(
				Record.values(
					Array.groupBy(
						Array.getSomes(
							Array.map(
								Record.values(
									Array.groupBy(
										Array.filter(entries, entry => entry.traceId !== ''),
										entry => entry.traceId
									)
								),
								records => traced(records, now)
							)
						),
						item => item.app
					)
				),
				Order.combine(
					Order.mapInput(Order.flip(Order.Number), (group: readonly Traced[]) => failureCount(group)),
					Order.mapInput(Order.flip(Order.Number), (group: readonly Traced[]) => group.length)
				)
			),
			group => ({name: Array.headNonEmpty(group).app, operations: operationsOf(group)})
		)
	} satisfies Overview
}
