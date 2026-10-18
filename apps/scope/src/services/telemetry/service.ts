import {SqliteClient} from '@effect/sql-sqlite-node'

import type {Stream} from 'effect'
import {
	Array,
	Boolean,
	Clock,
	Context,
	Crypto,
	Effect,
	Layer,
	Number,
	Option,
	Order,
	Schema,
	String,
	SubscriptionRef,
	pipe
} from 'effect'

import {
	attributeText,
	displayValue,
	durationMs,
	logMessage,
	orderEntries,
	serviceName,
	summary
} from '#services/telemetry/lib/utils.ts'
import type {
	LogsRequest,
	Page,
	Query,
	Stats,
	Trace,
	TraceSummary,
	TracesPage,
	TracesRequest
} from '#services/telemetry/schema.ts'
import {Entry, StoredEntry, TelemetryError} from '#services/telemetry/schema.ts'

const failed = Effect.mapError((cause: unknown) =>
	TelemetryError.make({cause, message: 'The telemetry database could not be read or written.'})
)

export class Telemetry extends Context.Service<
	Telemetry,
	{
		readonly changes: Stream.Stream<number>
		readonly ingestLogs: (payload: LogsRequest) => Effect.Effect<void, TelemetryError>
		readonly ingestTraces: (payload: TracesRequest) => Effect.Effect<void, TelemetryError>
		readonly logs: (query: Query) => Effect.Effect<Page, TelemetryError>
		readonly spans: (query: Query) => Effect.Effect<Page, TelemetryError>
		readonly stats: (query: Query) => Effect.Effect<Stats, TelemetryError>
		readonly trace: (id: Trace['id']) => Effect.Effect<Trace, TelemetryError>
		readonly traces: (query: Query) => Effect.Effect<TracesPage, TelemetryError>
	}
>()('@deslop/scope/services/telemetry/service/Telemetry') {
	static readonly layer = Layer.effect(
		this,
		pipe(
			Effect.gen(function* () {
				const sql = yield* SqliteClient.SqliteClient
				const revision = yield* SubscriptionRef.make(0)
				const crypto = yield* Crypto.Crypto
				yield* sql`create table if not exists entries (
			id text primary key, signal text not null, service text not null, operation text not null,
			trace_id text not null, time_ms real not null, status integer not null, search text not null, json text not null
		)`
				yield* sql`create index if not exists entries_time on entries(signal, time_ms)`
				yield* sql`create index if not exists entries_trace on entries(trace_id)`

				const save = Effect.fnUntraced(function* (entries: Entry[]) {
					yield* sql.withTransaction(
						Effect.forEach(
							entries,
							entry =>
								Effect.gen(function* () {
									yield* sql`insert into entries ${sql.insert({
										id: entry.id,
										json: yield* Schema.encodeEffect(Schema.fromJsonString(Entry))(entry),
										operation: entry.name,
										search: `${entry.name} ${displayValue(entry.payload)} ${attributeText(entry.resource)}`,
										service: entry.service,
										signal: entry.signal,
										status: entry.status,
										time_ms: pipe(Number.parse(`${BigInt(entry.time) / 1_000_000n}`), Option.getOrThrow),
										trace_id: entry.traceId
									})} on conflict(id) do update set json=excluded.json, operation=excluded.operation, search=excluded.search,
					service=excluded.service, status=excluded.status, time_ms=excluded.time_ms`
								}),
							{concurrency: 1, discard: true}
						)
					)
					yield* SubscriptionRef.update(revision, Number.increment)
				}, failed)

				const find = Effect.fnUntraced(function* (query: Query, signal: Entry['signal']) {
					const rows = yield* sql`select json from entries where ${sql.and([
						sql`signal = ${signal}`,
						sql`time_ms >= ${query.from} and time_ms <= ${query.to}`,
						sql`(${query.service} = '' or service = ${query.service})`,
						sql`(${query.operation} = '' or operation = ${query.operation})`,
						sql`(${query.traceId} = '' or trace_id = ${query.traceId})`,
						sql`(${Boolean.match(query.errors, {onFalse: () => 0, onTrue: () => 1})} = 0 or status = 2)`,
						sql`instr(lower(search), lower(${query.text})) > 0`
					])}`
					return Array.map(yield* Schema.decodeUnknownEffect(Schema.Array(StoredEntry))(rows), row => row.json)
				}, failed)

				const traceEntries = Effect.fnUntraced(function* (id: string) {
					return Array.map(
						yield* Schema.decodeUnknownEffect(Schema.Array(StoredEntry))(
							yield* sql`select json from entries where trace_id = ${String.toLowerCase(id)}`
						),
						row => row.json
					)
				}, failed)

				const page = Effect.fnUntraced(function* (query: Query, signal: Entry['signal']) {
					const entries = orderEntries(yield* find(query, signal), query.sort)
					return {entries: Array.take(Array.drop(entries, query.offset), query.limit), total: entries.length}
				})

				return Telemetry.of({
					changes: SubscriptionRef.changes(revision),
					ingestLogs: Effect.fn('Telemetry.ingestLogs')(function* (payload) {
						const now = `${BigInt(yield* Clock.currentTimeMillis) * 1_000_000n}`
						const entries = yield* Effect.forEach(
							Array.flatMap(payload.resourceLogs ?? [], group =>
								Array.flatMap(group.scopeLogs ?? [], scope =>
									Array.map(scope.logRecords ?? [], log => ({group, log, scope}))
								)
							),
							item =>
								Effect.map(pipe(crypto.randomUUIDv4(), failed), id => ({
									durationMs: 0,
									id,
									name: logMessage(item.log.body ?? {}),
									payload: item.log,
									resource: item.group.resource ?? {},
									resourceSchemaUrl: item.group.schemaUrl ?? '',
									scope: item.scope.scope ?? {},
									scopeSchemaUrl: item.scope.schemaUrl ?? '',
									service: serviceName(item.group.resource ?? {}),
									signal: 'log' as const,
									spanId: String.toLowerCase(item.log.spanId ?? ''),
									status: Boolean.match((item.log.severityNumber ?? 0) >= 17, {onFalse: () => 0, onTrue: () => 2}),
									time: item.log.timeUnixNano ?? item.log.observedTimeUnixNano ?? now,
									traceId: String.toLowerCase(item.log.traceId ?? '')
								})),
							{concurrency: 1}
						)
						yield* save(entries)
					}),
					ingestTraces: Effect.fn('Telemetry.ingestTraces')(function* (payload) {
						yield* save(
							Array.flatMap(payload.resourceSpans ?? [], group =>
								Array.flatMap(group.scopeSpans ?? [], scope =>
									Array.map(scope.spans ?? [], span => ({
										durationMs: durationMs(span.startTimeUnixNano, span.endTimeUnixNano ?? '0'),
										id: `${String.toLowerCase(span.traceId)}:${String.toLowerCase(span.spanId)}`,
										name: span.name ?? '',
										payload: span,
										resource: group.resource ?? {},
										resourceSchemaUrl: group.schemaUrl ?? '',
										scope: scope.scope ?? {},
										scopeSchemaUrl: scope.schemaUrl ?? '',
										service: serviceName(group.resource ?? {}),
										signal: 'trace' as const,
										spanId: String.toLowerCase(span.spanId),
										status: span.status?.code ?? 0,
										time: span.startTimeUnixNano,
										traceId: String.toLowerCase(span.traceId)
									}))
								)
							)
						)
					}),
					logs: Effect.fn('Telemetry.logs')(function* (query) {
						return yield* page(query, 'log')
					}),
					spans: Effect.fn('Telemetry.spans')(function* (query) {
						return yield* page(query, 'trace')
					}),
					stats: Effect.fn('Telemetry.stats')(function* (query) {
						return summary(yield* find(query, 'trace'), query)
					}),
					trace: Effect.fn('Telemetry.trace')(function* (id) {
						const entries = yield* traceEntries(id)
						if (Array.isReadonlyArrayEmpty(entries)) {
							return yield* TelemetryError.make({message: 'No spans or logs received for this trace.'})
						}
						return {entries: Array.reverse(orderEntries(entries, 'recent')), id}
					}),
					traces: Effect.fn('Telemetry.traces')(function* (query) {
						const entries = yield* Effect.forEach(
							Array.dedupe(Array.map(yield* find(query, 'trace'), entry => entry.traceId)),
							id =>
								Effect.gen(function* () {
									const spans = Array.filter(yield* traceEntries(id), entry => entry.signal === 'trace')
									const first = Option.getOrThrow(Array.last(orderEntries(spans, 'recent')))
									const root = Option.getOrElse(
										Array.findFirst(
											spans,
											entry => entry.payload['parentSpanId'] === undefined || entry.payload['parentSpanId'] === ''
										),
										() => first
									)
									const latest = Array.reduce(spans, BigInt(first.time), (end, span) => {
										const finish = span.payload['endTimeUnixNano']
										if (!String.isString(finish)) return end
										if (BigInt(finish) > end) return BigInt(finish)
										return end
									})
									return {
										durationMs: durationMs(first.time, `${latest}`),
										errors: Array.filter(spans, span => span.status === 2).length,
										id,
										operation: root.name,
										service: root.service,
										spans: spans.length,
										time: first.time
									}
								}),
							{concurrency: 1}
						)
						const sorted = Array.sort(
							entries,
							Boolean.match(query.sort === 'slowest', {
								onFalse: () => Order.flip(Order.mapInput(Order.BigInt, (entry: TraceSummary) => BigInt(entry.time))),
								onTrue: () => Order.flip(Order.mapInput(Order.Number, (entry: TraceSummary) => entry.durationMs))
							})
						)
						return {entries: Array.take(Array.drop(sorted, query.offset), query.limit), total: entries.length}
					})
				})
			}),
			failed
		)
	)
}
