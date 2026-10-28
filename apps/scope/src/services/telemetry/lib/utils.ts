import {
	Array,
	Boolean,
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

import {Nano, Runtime} from '#services/telemetry/schema.ts'
import type {Entry, Query, Resource, Stats, Trace} from '#services/telemetry/schema.ts'

// A log's own time, else when the exporter saw it; OTLP sends 0 for a time it does not know.
export function logTime(log: {observedTimeUnixNano?: string; timeUnixNano?: string}, now: string) {
	return pipe(
		Array.filter([log.timeUnixNano, log.observedTimeUnixNano], time => time !== undefined && time !== '0'),
		Array.head,
		Option.flatMap(Option.fromUndefinedOr),
		Option.getOrElse(() => now)
	)
}

function resourceString(resource: Resource, key: string) {
	return pipe(
		resource.attributes ?? [],
		Array.findFirst(attribute => attribute.key === key),
		Option.flatMap(attribute => Option.liftPredicate(attribute.value['stringValue'], String.isString)),
		Option.getOrElse(() => '')
	)
}

function runtime(resource: Resource) {
	const value = resourceString(resource, 'scope.runtime')
	if (Schema.is(Runtime)(value)) return value
	const language = resourceString(resource, 'telemetry.sdk.language')
	if (language === 'webjs') return 'web' as const
	if (language === 'nodejs') return 'server' as const
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
	return Array.reduce(entries, Array.headNonEmpty(entries), (current, entry) => {
		if (run(entry) > run(current)) return entry
		return current
	})
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

export function summary(entries: Entry[], query: Query) {
	const times = Array.sort(
		Array.map(entries, entry => entry.durationMs),
		Order.Number
	)
	function percentile(ratio: number) {
		return pipe(
			Array.get(times, Number.max(0, Math.ceil(times.length * ratio) - 1)),
			Option.getOrElse(() => 0)
		)
	}
	return {
		count: entries.length,
		errors: Array.countBy(entries, entry => entry.status === 2),
		from: query.from,
		maxMs: percentile(1),
		p50Ms: percentile(0.5),
		p95Ms: percentile(0.95),
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

export function orderEntries<A extends {durationMs: number; time: string}>(entries: A[], sort: Query['sort']) {
	return Array.sort(
		entries,
		Boolean.match(sort === 'slowest', {
			onFalse: () => Order.flip(Order.mapInput(Order.BigInt, (entry: A) => BigInt(entry.time))),
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
				lastEventAt: Array.reduce(current, '0', (time, entry) => {
					if (BigInt(entry.time) > BigInt(time)) return entry.time
					return time
				}),
				name,
				runStartedAt: `${run}`,
				runtime: runtime(latest.resource)
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
				Order.mapInput(Order.BigInt, (time: string) => BigInt(time))
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
		id,
		logs: Array.filter(logs, log => !Record.has(byId, log.spanId)),
		services: Array.dedupeWith(
			Array.map([...tree, ...logs], entry => ({name: entry.service, runtime: runtime(entry.resource)})),
			(left, right) => left.name === right.name
		),
		spans: tree
	} satisfies Trace
}
