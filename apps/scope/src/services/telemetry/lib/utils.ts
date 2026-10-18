import {Array, Boolean, HashSet, Number, Option, Order, Record, Schema, String, pipe} from 'effect'

import {AttributeArray, Nano, Runtime} from '#services/telemetry/schema.ts'
import type {Entry, Query, Resource, Service, Stats, Trace} from '#services/telemetry/schema.ts'

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

export function currentEntries(entries: Entry[]) {
	const latest = Record.map(
		Array.groupBy(entries, entry => entry.service),
		group =>
			Array.reduce(group, 0n, (current, entry) => {
				const start = started(entry.resource)
				if (start > current) return start
				return current
			})
	)
	const stale = HashSet.fromIterable(
		Array.map(
			Array.filter(entries, entry => entry.traceId !== '' && started(entry.resource) < (latest[entry.service] ?? 0n)),
			entry => entry.traceId
		)
	)
	return Array.filter(
		entries,
		entry => started(entry.resource) === (latest[entry.service] ?? 0n) && !HashSet.has(stale, entry.traceId)
	)
}

export function serviceName(resource: Resource) {
	const value = resourceString(resource, 'service.name')
	if (String.isNonEmpty(value)) return value
	return 'unknown'
}

export function displayValue(value: unknown) {
	return JSON.stringify(value, undefined, 2)
}

function attributeValue(value: Schema.JsonObject): Schema.Json {
	if (Schema.is(AttributeArray)(value)) return Array.map(value.arrayValue.values, attributeValue)
	if (value['stringValue'] !== undefined) return value['stringValue']
	if (value['boolValue'] !== undefined) return value['boolValue']
	if (value['intValue'] !== undefined) return value['intValue']
	if (value['doubleValue'] !== undefined) return value['doubleValue']
	if (value['bytesValue'] !== undefined) return value['bytesValue']
	return value
}

export function attributes(resource: Resource) {
	return Record.fromEntries(
		Array.map(resource.attributes ?? [], attribute => [attribute.key, attributeValue(attribute.value)] as const)
	)
}

export function treeBranches(spans: Trace['spans'], span: Trace['spans'][number]) {
	return Array.reverse(
		Array.unfold({remaining: span.depth, span}, current => {
			if (current.remaining === 0) return Option.none()
			return pipe(
				Array.findFirst(spans, parent => parent.spanId === current.span.parentSpanId),
				Option.map(
					parent =>
						[
							pipe(
								Array.findLast(spans, sibling => sibling.parentSpanId === current.span.parentSpanId),
								Option.exists(sibling => sibling.spanId !== current.span.spanId)
							),
							{remaining: current.remaining - 1, span: parent}
						] as const
				)
			)
		})
	)
}

export function logMessage(body: Schema.JsonObject) {
	if (String.isString(body['stringValue'])) return body['stringValue']
	return displayValue(body)
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
		errors: Array.filter(entries, entry => entry.status === 2).length,
		from: query.from,
		maxMs: percentile(1),
		p50Ms: percentile(0.5),
		p95Ms: percentile(0.95),
		to: query.to
	} satisfies Stats
}

export function orderEntries(entries: Entry[], sort: Query['sort']) {
	return Array.sort(
		entries,
		Boolean.match(sort === 'slowest', {
			onFalse: () => Order.flip(Order.mapInput(Order.BigInt, (entry: Entry) => BigInt(entry.time))),
			onTrue: () => Order.flip(Order.mapInput(Order.Number, (entry: Entry) => entry.durationMs))
		})
	)
}

export function services(entries: Entry[]) {
	return Array.dedupeWith(
		Array.map(entries, entry => ({name: entry.service, runtime: runtime(entry.resource)})),
		(left: Service, right: Service) => left.name === right.name
	)
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
	const start = pipe(
		Array.head(Array.map(spans, span => span.entry)),
		Option.orElse(() => Array.head(ordered)),
		Option.match({onNone: () => '0', onSome: entry => entry.time})
	)
	const logs = Array.filter(ordered, entry => entry.signal === 'log')
	const nodes = Array.map(spans, span => {
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
				logs: Array.filter(logs, log => log.spanId === span.entry.spanId),
				offsetMs: durationMs(start, span.entry.time),
				parentSpanId: parentId(span.entry),
				runtime: runtime(span.entry.resource)
			}
		}
	})
	const tree = pipe(
		nodes,
		Array.sort(Order.Struct({path: Order.Array(Order.Number)})),
		Array.map(node => node.value)
	)
	return {
		durationMs: Array.reduce(nodes, 0, (end, node) => Number.max(end, node.value.offsetMs + node.value.durationMs)),
		id,
		logs: Array.filter(logs, log => !Record.has(byId, log.spanId)),
		services: services([...tree, ...logs]),
		spans: tree
	} satisfies Trace
}
