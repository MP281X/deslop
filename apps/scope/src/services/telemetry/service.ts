import {SqliteClient} from '@effect/sql-sqlite-node'

import {Array, Boolean, Clock, Context, Crypto, Effect, Layer, Option, Order, Schema, String, pipe} from 'effect'

import {
	currentEntries,
	durationMs,
	filterEntries,
	logMessage,
	orderEntries,
	serviceName,
	services,
	summary,
	traceView
} from '#services/telemetry/lib/utils.ts'
import type {LogsRequest, Query, TraceSummary, TracesRequest} from '#services/telemetry/schema.ts'
import {Entry, StoredEntry, TelemetryError} from '#services/telemetry/schema.ts'

const failed = Effect.mapError((cause: unknown) =>
	TelemetryError.make({cause, message: 'The telemetry database could not be read or written.'})
)

export class Telemetry extends Context.Service<Telemetry>()('@deslop/scope/services/telemetry/service/Telemetry', {
	make: pipe(
		Effect.gen(function* () {
			const sql = yield* SqliteClient.SqliteClient
			const crypto = yield* Crypto.Crypto
			yield* sql`create table if not exists telemetry (id text primary key, json text not null)`
			yield* sql`drop table if exists entries`

			const read = Effect.fnUntraced(function* () {
				return Array.map(
					yield* Schema.decodeUnknownEffect(Schema.Array(StoredEntry))(yield* sql`select json from telemetry`),
					row => row.json
				)
			}, failed)
			const save = Effect.fnUntraced(function* (entries: Entry[]) {
				yield* sql.withTransaction(
					Effect.forEach(
						entries,
						entry =>
							Effect.gen(function* () {
								yield* sql`insert into telemetry ${sql.insert({id: entry.id, json: yield* Schema.encodeEffect(Schema.fromJsonString(Entry))(entry)})} on conflict(id) do update set json=excluded.json`
							}),
						{concurrency: 1, discard: true}
					)
				)
			}, failed)
			const page = Effect.fnUntraced(function* (query: Query, signal: Entry['signal']) {
				const entries = orderEntries(filterEntries(currentEntries(yield* read()), query, signal), query.sort)
				return {entries: Array.take(Array.drop(entries, query.offset), query.limit), total: entries.length}
			})
			return {
				ingestLogs: Effect.fn('Telemetry.ingestLogs')(function* (payload: LogsRequest) {
					const now = `${BigInt(yield* Clock.currentTimeMillis) * 1_000_000n}`
					yield* save(
						yield* Effect.forEach(
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
					)
				}),
				ingestTraces: Effect.fn('Telemetry.ingestTraces')(function* (payload: TracesRequest) {
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
				logs: Effect.fn('Telemetry.logs')(function* (query: Query) {
					return yield* page(query, 'log')
				}),
				services: Effect.fn('Telemetry.services')(function* () {
					return services(currentEntries(yield* read()))
				}),
				spans: Effect.fn('Telemetry.spans')(function* (query: Query) {
					return yield* page(query, 'trace')
				}),
				stats: Effect.fn('Telemetry.stats')(function* (query: Query) {
					return summary(filterEntries(currentEntries(yield* read()), query, 'trace'), query)
				}),
				trace: Effect.fn('Telemetry.trace')(function* (id: string) {
					const entries = yield* read()
					if (!Array.some(entries, entry => entry.traceId === String.toLowerCase(id))) {
						return yield* TelemetryError.make({message: 'No telemetry received for this trace.'})
					}
					return traceView(
						Array.filter(currentEntries(entries), entry => entry.traceId === String.toLowerCase(id)),
						id
					)
				}),
				traces: Effect.fn('Telemetry.traces')(function* (query: Query) {
					const active = currentEntries(yield* read())
					const entries = Array.map(
						Array.dedupe(
							Array.map(
								Array.filter(filterEntries(active, query, 'all'), entry => entry.traceId !== ''),
								entry => entry.traceId
							)
						),
						id => {
							const records = Array.filter(active, entry => entry.traceId === id)
							const view = traceView(records, id)
							const root = Option.getOrElse(Array.head(view.spans), () => Option.getOrThrow(Array.head(records)))
							return {
								durationMs: view.durationMs,
								errors: Array.countBy(records, entry => entry.status === 2),
								id,
								logs: Array.countBy(records, entry => entry.signal === 'log'),
								operation: root.name,
								service: root.service,
								services: view.services,
								spans: view.spans.length,
								time: root.time
							}
						}
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
			}
		}),
		failed
	)
}) {
	static readonly layer = Layer.effect(this, this.make)
}
