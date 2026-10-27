import {
	Array,
	Boolean,
	Clock,
	Context,
	Crypto,
	Duration,
	Effect,
	FileSystem,
	HashMap,
	Layer,
	Option,
	Path,
	Record,
	Ref,
	Schedule,
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
	traceTiming,
	traceView
} from '#services/telemetry/lib/utils.ts'
import type {LogsRequest, Query, Rejection, TraceSummary, TracesRequest} from '#services/telemetry/schema.ts'
import {Entry, TelemetryError} from '#services/telemetry/schema.ts'

const RETENTION = Duration.days(3)

const failed = Effect.mapError((cause: unknown) =>
	TelemetryError.make({cause, message: 'The telemetry storage could not be read or written.'})
)

export class Telemetry extends Context.Service<Telemetry>()('@deslop/scope/services/telemetry/service/Telemetry', {
	make: Effect.fnUntraced(function* (directory: string) {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Entry)
		const crypto = yield* Crypto.Crypto
		const since = yield* Clock.currentTimeMillis
		const rejections = yield* Ref.make(Record.empty<string, Rejection>())
		const saved = yield* Effect.forEach(
			yield* fs.readDirectory(directory),
			file =>
				pipe(
					Effect.try(() => decodeURIComponent(file)),
					Effect.filterOrFail(key => !String.endsWith('.tmp')(key)),
					Effect.flatMap(key => store.get(key)),
					// A write cut short or an entry of an older shape is dropped rather than keeping Scope from starting.
					Effect.catch(() => Effect.as(fs.remove(path.join(directory, file), {force: true}), Option.none()))
				),
			{concurrency: 8}
		)
		const state = yield* SynchronizedRef.make(
			HashMap.fromIterable(Array.map(Array.getSomes(saved), entry => [entry.id, entry] as const))
		)
		// A development debugger needs recent runs; older entries would only slow every start and query.
		const prune = Effect.gen(function* () {
			const cutoff = BigInt((yield* Clock.currentTimeMillis) - Duration.toMillis(RETENTION)) * 1_000_000n
			yield* SynchronizedRef.updateEffect(state, current => {
				const expired = Array.filter(Array.fromIterable(HashMap.values(current)), entry => BigInt(entry.time) < cutoff)
				return Effect.as(
					Effect.forEach(expired, entry => store.remove(entry.id), {concurrency: 1, discard: true}),
					Array.reduce(expired, current, (all, entry) => HashMap.remove(all, entry.id))
				)
			})
		})
		yield* prune
		yield* pipe(
			prune,
			Effect.ignore({log: 'Warn', message: 'Expired telemetry could not be deleted'}),
			Effect.repeat(Schedule.spaced('1 hour')),
			Effect.forkScoped
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
				const traceId = String.toLowerCase(id)
				const records = Array.filter(yield* read, entry => entry.traceId === traceId)
				if (Array.isReadonlyArrayEmpty(records)) {
					return yield* TelemetryError.make({message: 'No telemetry received for this trace.'})
				}
				return traceView(records, traceId)
			}),
			traces: Effect.fn('Telemetry.traces')(function* (query: Query) {
				const active = yield* selected(query.runs)
				const byTrace = Array.groupBy(active, entry => entry.traceId)
				const ids = Array.dedupe(
					Array.map(
						Array.filter(filterEntries(active, query, 'all'), entry => entry.traceId !== ''),
						entry => entry.traceId
					)
				)
				// Ordering needs only each trace's start and length, so only the page's traces are assembled.
				const ordered = orderEntries(
					Array.map(ids, id => ({id, ...traceTiming(byTrace[id] ?? [])})),
					query.sort
				)
				return {
					entries: Array.map(Array.take(Array.drop(ordered, query.offset), query.limit), found => {
						const records = byTrace[found.id] ?? []
						const view = traceView(records, found.id)
						const root = Option.getOrElse(Array.head(view.spans), () => Option.getOrThrow(Array.head(records)))
						return {
							durationMs: found.durationMs,
							errors: Array.countBy(records, entry => entry.status === 2),
							id: found.id,
							logs: Array.countBy(records, entry => entry.signal === 'log'),
							operation: root.name,
							service: root.service,
							services: view.services,
							spans: view.spans.length,
							// The trace's first span, which orders the page; a skewed client clock can start a child before its root.
							time: found.time
						} satisfies TraceSummary
					}),
					total: ids.length
				}
			})
		}
	}, failed)
}) {
	static readonly layer = (directory: string) =>
		pipe(Layer.effect(this, this.make(directory)), Layer.provide(layerKeyValueStore(directory)))
}
