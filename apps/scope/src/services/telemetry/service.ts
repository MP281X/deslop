import {
	Array,
	Boolean,
	Clock,
	Context,
	Duration,
	Effect,
	FileSystem,
	HashMap,
	Layer,
	Number,
	Option,
	Path,
	Record,
	Ref,
	Schedule,
	Stream,
	String,
	SubscriptionRef,
	SynchronizedRef,
	pipe
} from 'effect'

import {SecureRandom} from 'effect/crypto'
import {KeyValueStore} from 'effect/persistence'

import {layerKeyValueStore} from '@deslop/runtime/server'

import {
	currentEntries,
	durationMs,
	filterEntries,
	logMessage,
	newestVersions,
	orderEntries,
	overview,
	reconcileReleases,
	retentionOf,
	serviceName,
	serviceStatuses,
	spanName,
	summary,
	traceTiming,
	traceView
} from '#services/telemetry/lib/utils.ts'
import type {LogsRequest, Query, Range, Rejection, TraceSummary, TracesRequest} from '#services/telemetry/schema.ts'
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
		const random = yield* SecureRandom.SecureRandom
		const since = yield* Clock.currentTimeMillis
		const rejections = yield* Ref.make(Record.empty<string, Rejection>())
		const saved = yield* Effect.forEach(
			yield* fs.readDirectory(directory),
			file =>
				pipe(
					Effect.try({
						catch: cause => TelemetryError.make({cause, message: `${file} has no readable name.`}),
						try: () => decodeURIComponent(file)
					}),
					Effect.filterOrFail(key => !String.endsWith('.tmp')(key)),
					Effect.flatMap(key => store.get(key)),
					// A write cut short or an entry of an older shape is dropped rather than keeping Scope from starting.
					Effect.catch(() => Effect.as(fs.remove(path.join(directory, file), {force: true}), Option.none()))
				),
			{concurrency: 8}
		)
		// Bumped when traces arrive or expire, so the live page recomputes only when its rows can change.
		const version = yield* SubscriptionRef.make(0)
		// Each service's newest release seen: what an older one sent may describe a bug since fixed, so it goes.
		const releases = yield* Ref.make(newestVersions(Array.getSomes(saved), Record.empty()))
		// Spans kept from an older release are named as new ones are, so an operation never splits across a release.
		const state = yield* SynchronizedRef.make(
			HashMap.fromIterable(
				Array.map(Array.getSomes(saved), entry => {
					if (entry.signal === 'log') return [entry.id, entry] as const
					return [entry.id, {...entry, name: spanName(entry.payload)}] as const
				})
			)
		)
		// A development debugger needs recent runs of the current release; older entries would only slow every start and query.
		const prune = Effect.gen(function* () {
			const receivedAt = yield* Clock.currentTimeMillis
			const newest = yield* Ref.get(releases)
			yield* SynchronizedRef.updateEffect(
				state,
				Effect.fnUntraced(function* (current) {
					const retention = retentionOf(current, newest, receivedAt, Duration.toMillis(RETENTION))
					yield* Effect.forEach(retention.repaired, entry => store.set(entry.id, entry), {
						concurrency: 1,
						discard: true
					})
					yield* Effect.forEach(retention.expired, entry => store.remove(entry.id), {concurrency: 1, discard: true})
					return retention.next
				})
			)
			yield* SubscriptionRef.update(version, Number.increment)
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
		// What an older release sends is dropped; a newer release's first entries delete everything its service's older ones sent.
		const save = Effect.fnUntraced(function* (entries: Entry[]) {
			yield* Effect.uninterruptible(
				SynchronizedRef.updateEffect(
					state,
					Effect.fnUntraced(function* (current) {
						const reconciliation = reconcileReleases(current, entries, yield* Ref.get(releases))
						yield* Effect.forEach(reconciliation.replaced, entry => store.remove(entry.id), {
							concurrency: 1,
							discard: true
						})
						yield* Effect.forEach(reconciliation.accepted, entry => store.set(entry.id, entry), {
							concurrency: 1,
							discard: true
						})
						yield* Ref.set(releases, reconciliation.newest)
						return reconciliation.next
					})
				)
			)
			yield* SubscriptionRef.update(version, Number.increment)
		}, failed)
		// Open pages share one scan; without a viewer there is no scan. Changes coalesce during the one-second pause.
		const live = yield* pipe(
			SubscriptionRef.changes(version),
			Stream.buffer({capacity: 1, strategy: 'sliding'}),
			Stream.flatMap(() =>
				Stream.concat(
					Stream.fromEffect(Effect.all({entries: read, now: Clock.currentTimeMillis}, {concurrency: 'unbounded'})),
					Stream.drain(Stream.fromEffect(Effect.sleep('1 second')))
				)
			),
			Stream.share({capacity: 1, replay: 1, strategy: 'sliding'})
		)
		const page = Effect.fnUntraced(function* (query: Query, signal: Entry['signal']) {
			const entries = orderEntries(filterEntries(yield* selected(query.runs), query, signal), query.sort)
			return {entries: Array.take(Array.drop(entries, query.offset), query.limit), total: entries.length}
		})
		return {
			ingestLogs: Effect.fn('Telemetry.ingestLogs')(function* (payload: LogsRequest) {
				const receivedAt = yield* Clock.currentTimeMillis
				yield* save(
					yield* Effect.forEach(
						Array.flatMap(payload.resourceLogs ?? [], group =>
							Array.flatMap(group.scopeLogs ?? [], scope =>
								Array.map(scope.logRecords ?? [], log => ({group, log, scope}))
							)
						),
						item =>
							Effect.map(random.uuidV4(), id => ({
								durationMs: 0,
								id,
								name: logMessage(item.log.body ?? {}),
								payload: item.log,
								receivedAt,
								resource: item.group.resource ?? {},
								service: serviceName(item.group.resource ?? {}),
								signal: 'log' as const,
								spanId: String.toLowerCase(item.log.spanId ?? ''),
								status: Boolean.match((item.log.severityNumber ?? 0) >= 17, {onFalse: () => 0, onTrue: () => 2}),
								time: item.log.timeUnixNano,
								traceId: String.toLowerCase(item.log.traceId ?? '')
							})),
						{concurrency: 1}
					)
				)
			}),
			ingestTraces: Effect.fn('Telemetry.ingestTraces')(function* (payload: TracesRequest) {
				const receivedAt = yield* Clock.currentTimeMillis
				yield* save(
					Array.flatMap(payload.resourceSpans ?? [], group =>
						Array.flatMap(group.scopeSpans ?? [], scope =>
							Array.map(scope.spans ?? [], span => ({
								durationMs: durationMs(span.startTimeUnixNano, span.endTimeUnixNano ?? '0'),
								id: `${String.toLowerCase(span.traceId)}:${String.toLowerCase(span.spanId)}`,
								name: spanName(span),
								payload: span,
								receivedAt,
								resource: group.resource ?? {},
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
			// The same snapshot for every viewer; each time frame maps it to its own operations and traces.
			overview: (range: Range) => Stream.map(live, current => overview(current.entries, current.now, range)),
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
					return yield* TelemetryError.make({
						message:
							'No kept telemetry has this trace id: check the id, check ingestion with list_services, or reproduce it if it is older than three days.'
					})
				}
				return traceView(records, traceId)
			}),
			traces: Effect.fn('Telemetry.traces')(function* (query: Query) {
				const active = yield* selected(query.runs)
				const byTrace = Array.groupBy(active, entry => entry.traceId)
				const ids = Array.filter(
					Array.dedupe(
						Array.map(
							Array.filter(filterEntries(active, query, 'all'), entry => entry.traceId !== ''),
							entry => entry.traceId
						)
					),
					id => Array.some(byTrace[id] ?? [], entry => entry.signal === 'trace')
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
						const root = Option.getOrThrow(Array.head(view.spans))
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
