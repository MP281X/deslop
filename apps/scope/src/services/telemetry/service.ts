import {
	Array,
	Boolean,
	Clock,
	Context,
	Crypto,
	Effect,
	FileSystem,
	HashMap,
	Layer,
	Option,
	Order,
	Record,
	Ref,
	String,
	SynchronizedRef,
	pipe
} from 'effect'

import {KeyValueStore} from 'effect/persistence'

import {layerKeyValueStore} from '@deslop/runtime/server'

import {
	currentEntries,
	durationMs,
	filterEntries,
	logMessage,
	orderEntries,
	serviceName,
	serviceStatuses,
	summary,
	traceView
} from '#services/telemetry/lib/utils.ts'
import type {LogsRequest, Query, Rejection, TraceSummary, TracesRequest} from '#services/telemetry/schema.ts'
import {Entry, TelemetryError} from '#services/telemetry/schema.ts'

const failed = Effect.mapError((cause: unknown) =>
	TelemetryError.make({cause, message: 'The telemetry storage could not be read or written.'})
)

export class Telemetry extends Context.Service<Telemetry>()('@deslop/scope/services/telemetry/service/Telemetry', {
	make: Effect.fnUntraced(function* (directory: string) {
		const fs = yield* FileSystem.FileSystem
		const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Entry)
		const crypto = yield* Crypto.Crypto
		const since = yield* Clock.currentTimeMillis
		const rejections = yield* Ref.make(Record.empty<string, Rejection>())
		const saved = yield* Effect.forEach(
			Array.filter(yield* fs.readDirectory(directory), file => !String.endsWith('.tmp')(file)),
			file =>
				Effect.flatMap(
					Effect.try(() => decodeURIComponent(file)),
					key => store.get(key)
				),
			{concurrency: 8}
		)
		const state = yield* SynchronizedRef.make(
			HashMap.fromIterable(Array.map(Array.getSomes(saved), entry => [entry.id, entry] as const))
		)
		const read = Effect.map(SynchronizedRef.get(state), entries => Array.fromIterable(HashMap.values(entries)))
		const selected = Effect.fnUntraced(function* (runs: Query['runs']) {
			const entries = yield* read
			if (runs === 'all') return entries
			return currentEntries(entries)
		})
		const save = Effect.fnUntraced(function* (entries: Entry[]) {
			yield* Effect.uninterruptible(
				SynchronizedRef.updateEffect(state, current =>
					Effect.as(
						Effect.forEach(entries, entry => store.set(entry.id, entry), {concurrency: 1, discard: true}),
						Array.reduce(entries, current, (all, entry) => HashMap.set(all, entry.id, entry))
					)
				)
			)
		}, failed)
		const page = Effect.fnUntraced(function* (query: Query, signal: Entry['signal']) {
			const entries = orderEntries(filterEntries(yield* selected(query.runs), query, signal), query.sort)
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
			reject: Effect.fnUntraced(function* (input: Pick<Rejection, 'credential' | 'route' | 'status'>) {
				const now = yield* Clock.currentTimeMillis
				const key = `${input.route}:${input.status}:${input.credential}`
				yield* Ref.update(rejections, current =>
					Record.set(current, key, {...input, count: (current[key]?.count ?? 0) + 1, lastAt: now})
				)
			}),
			services: Effect.fn('Telemetry.services')(function* () {
				return {rejections: Record.values(yield* Ref.get(rejections)), services: serviceStatuses(yield* read), since}
			}),
			spans: Effect.fn('Telemetry.spans')(function* (query: Query) {
				return yield* page(query, 'trace')
			}),
			stats: Effect.fn('Telemetry.stats')(function* (query: Query) {
				return summary(filterEntries(yield* selected(query.runs), query, 'trace'), query)
			}),
			trace: Effect.fn('Telemetry.trace')(function* (id: string) {
				const entries = yield* read
				if (!Array.some(entries, entry => entry.traceId === String.toLowerCase(id))) {
					return yield* TelemetryError.make({message: 'No telemetry received for this trace.'})
				}
				return traceView(
					Array.filter(entries, entry => entry.traceId === String.toLowerCase(id)),
					id
				)
			}),
			traces: Effect.fn('Telemetry.traces')(function* (query: Query) {
				const active = yield* selected(query.runs)
				const byTrace = Array.groupBy(active, entry => entry.traceId)
				const entries = Array.map(
					Array.dedupe(
						Array.map(
							Array.filter(filterEntries(active, query, 'all'), entry => entry.traceId !== ''),
							entry => entry.traceId
						)
					),
					id => {
						const records = byTrace[id] ?? []
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
	}, failed)
}) {
	static readonly layer = (directory: string) =>
		pipe(Layer.effect(this, this.make(directory)), Layer.provide(layerKeyValueStore(directory)))
}
