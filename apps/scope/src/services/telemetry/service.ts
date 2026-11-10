import {
	Array,
	Boolean,
	Clock,
	Context,
	Duration,
	Effect,
	FileSystem,
	HashMap,
	HashSet,
	Layer,
	Number,
	Option,
	Order,
	Path,
	Predicate,
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
	appName,
	attributesFlat,
	brokeAt,
	deniedSpan,
	durationMs,
	entryText,
	failed,
	failureMessage,
	isoMillis,
	isoTime,
	levelOf,
	logMessage,
	newestVersions,
	overviewOf,
	reconcileReleases,
	retentionOf,
	rounded,
	serviceName,
	serviceStatuses,
	sideFor,
	sideOf,
	spanName,
	traceRoot,
	traceTiming,
	traceView,
	tracedOf
} from '#services/telemetry/lib/utils.ts'
import type {Traced} from '#services/telemetry/lib/utils.ts'
import type {
	CompactLog,
	FindTracesParams,
	IngestionAnswer,
	LatencyAnswer,
	ListOperationsParams,
	LogsAnswer,
	LogsRequest,
	MeasureLatencyParams,
	Operation,
	OperationRow,
	OperationTrace,
	OperationsAnswer,
	Range,
	ReadTraceAnswer,
	ReadTraceParams,
	Rejection,
	SearchLogsParams,
	TraceRow,
	TracesAnswer,
	TracesRequest
} from '#services/telemetry/schema.ts'
import {Entry, rangeStart, TelemetryError} from '#services/telemetry/schema.ts'

const RETENTION = Duration.days(3)

const failedSave = Effect.mapError((cause: unknown) =>
	TelemetryError.make({cause, message: 'The telemetry storage could not be read or written.'})
)

// The newest failing trace an operation holds, whose span and message the tools show.
function latestFailure(traces: readonly OperationTrace[]) {
	return Array.match(
		Array.filter(traces, trace => trace.failure !== undefined),
		{
			onEmpty: () => undefined,
			onNonEmpty: failures =>
				Array.max(
					failures,
					Order.mapInput(Order.BigInt, trace => BigInt(trace.time))
				)
		}
	)
}

// The page's own operations for one frame, failing first and then most recent, with the numbers the tools need.
function operationsAnswer(traces: readonly Traced[], now: number, input: ListOperationsParams) {
	const apps = Array.map(
		Array.filter(overviewOf(traces, now, input.since).apps, app => input.app === undefined || app.name === input.app),
		app => ({
			app: app.name,
			operations: Array.map(
				Array.sort(
					app.operations,
					Order.combine(
						Order.mapInput(Order.flip(Order.Boolean), (operation: Operation) => operation.failures > 0),
						Order.mapInput(Order.flip(Order.BigInt), (operation: Operation) =>
							Array.match(operation.traces, {
								onEmpty: () => 0n,
								onNonEmpty: found =>
									BigInt(
										Array.max(
											found,
											Order.mapInput(Order.BigInt, (trace: OperationTrace) => BigInt(trace.time))
										).time
									)
							})
						)
					)
				),
				operation => {
					const slowest = Option.getOrThrow(Array.head(operation.traces))
					const failure = latestFailure(operation.traces)
					const side = sideFor(app.name, operation.runtime)
					return {
						name: operation.name,
						p50Ms: rounded(operation.p50Ms),
						p95Ms: rounded(operation.p95Ms),
						runs: operation.count,
						slowest: slowest.id,
						...Boolean.match(operation.failures > 0, {
							onFalse: () => ({}),
							onTrue: () => ({failures: operation.failures})
						}),
						...Option.match(Option.fromUndefinedOr(side), {onNone: () => ({}), onSome: value => ({side: value})}),
						...Option.match(Option.fromUndefinedOr(failure), {
							onNone: () => ({}),
							onSome: found => ({
								failure: {
									span: found.failure?.span ?? '',
									trace: found.id,
									...Option.match(Option.fromNullishOr(found.failure?.error), {
										onNone: () => ({}),
										onSome: error => ({error})
									})
								}
							})
						})
					} satisfies OperationRow
				}
			)
		})
	)
	return {apps: Array.filter(apps, app => Array.isReadonlyArrayNonEmpty(app.operations))} satisfies OperationsAnswer
}

function findTracesAnswer(entries: readonly Entry[], input: FindTracesParams, now: number) {
	const cutoff = rangeStart(input.since, now)
	const text = Option.getOrElse(Option.map(Option.fromUndefinedOr(input.text), String.toLowerCase), () => '')
	type Candidate = {row: TraceRow; timing: ReturnType<typeof traceTiming>}
	const rows = Array.getSomes(
		Array.map(
			Record.values(
				Array.groupBy(
					Array.filter(entries, entry => entry.traceId !== ''),
					entry => entry.traceId
				)
			),
			records => {
				const spans = Array.filter(records, entry => entry.signal === 'trace')
				if (!Array.isReadonlyArrayNonEmpty(spans)) return Option.none<Candidate>()
				const timing = traceTiming([...records])
				if (BigInt(timing.time) < cutoff) return Option.none<Candidate>()
				const root = traceRoot(spans)
				const app = appName(root.service)
				if (input.app !== undefined && app !== input.app) return Option.none<Candidate>()
				if (input.operation !== undefined && root.name !== input.operation) return Option.none<Candidate>()
				if (input.span !== undefined && !Array.some(spans, span => span.name === input.span)) {
					return Option.none<Candidate>()
				}
				if (text !== '' && !Array.some(records, entry => String.includes(text)(entryText(entry)))) {
					return Option.none<Candidate>()
				}
				const broken = brokeAt(spans)
				if (input.errors && Option.isNone(broken)) return Option.none<Candidate>()
				const side = sideOf(root.service, root.resource)
				const failure = Option.map(broken, span => {
					const error = failureMessage(span.payload)
					if (String.isNonEmpty(error)) return `${span.name}: ${error}`
					return span.name
				})
				return Option.some<Candidate>({
					row: {
						app,
						at: isoTime(timing.time),
						id: root.traceId,
						ms: rounded(timing.durationMs),
						operation: root.name,
						spans: spans.length,
						...Option.match(Option.fromUndefinedOr(side), {onNone: () => ({}), onSome: value => ({side: value})}),
						...Option.match(failure, {onNone: () => ({}), onSome: message => ({failure: message})})
					},
					timing
				})
			}
		)
	)
	const sorted = Boolean.match(input.sort === 'slowest', {
		onFalse: () =>
			Array.sort(rows, Order.flip(Order.mapInput(Order.BigInt, (row: Candidate) => BigInt(row.timing.time)))),
		onTrue: () =>
			Array.sort(
				rows,
				Order.mapInput(Order.flip(Order.Number), (row: Candidate) => row.timing.durationMs)
			)
	})
	return {
		total: rows.length,
		traces: Array.map(Array.take(sorted, input.limit), item => item.row)
	} satisfies TracesAnswer
}

function compactLog(entry: Pick<Entry, 'name' | 'payload' | 'time'>) {
	return {at: isoTime(entry.time), level: levelOf(entry), message: entry.name} satisfies CompactLog
}

function compactSpan(span: ReturnType<typeof traceView>['spans'][number]) {
	const failedSpan = failed(span)
	const error = Boolean.match(failedSpan, {onFalse: () => '', onTrue: () => failureMessage(span.payload)})
	const attrs = attributesFlat(span.payload, span.name, failedSpan)
	const side = sideOf(span.service, span.resource)
	const logs = Array.map(span.logs, compactLog)
	return {
		app: appName(span.service),
		at: rounded(span.offsetMs),
		id: span.spanId,
		ms: rounded(span.durationMs),
		name: span.name,
		...Boolean.match(span.parentSpanId !== '', {onFalse: () => ({}), onTrue: () => ({parent: span.parentSpanId})}),
		...Option.match(Option.fromUndefinedOr(side), {onNone: () => ({}), onSome: value => ({side: value})}),
		...Boolean.match(String.isNonEmpty(error), {onFalse: () => ({}), onTrue: () => ({error})}),
		...Boolean.match(span.denied === true, {onFalse: () => ({}), onTrue: () => ({denied: true})}),
		...Option.match(Option.fromUndefinedOr(attrs), {onNone: () => ({}), onSome: value => ({attrs: value})}),
		...Boolean.match(Array.isReadonlyArrayNonEmpty(logs), {onFalse: () => ({}), onTrue: () => ({logs})})
	}
}

function readTraceAnswer(records: readonly Entry[], id: string, limit: number) {
	const view = traceView([...records], id)
	const timing = traceTiming([...records])
	const failureSpan = Option.flatMap(Option.fromUndefinedOr(view.failureSpanId), spanId =>
		Array.findFirst(view.spans, span => span.spanId === spanId)
	)
	const ancestors = Option.match(failureSpan, {
		onNone: () => HashSet.empty<string>(),
		onSome: span =>
			HashSet.fromIterable(
				Array.unfold({id: span.spanId, seen: HashSet.empty<string>()}, current => {
					if (current.id === '' || HashSet.has(current.seen, current.id)) return Option.none()
					const seen = HashSet.add(current.seen, current.id)
					return Option.map(
						Array.findFirst(view.spans, found => found.spanId === current.id),
						found => [found.spanId, {id: found.parentSpanId, seen}] as const
					)
				})
			)
	})
	const kept = Array.reduce(
		Array.sort(
			view.spans,
			Order.mapInput(Order.flip(Order.Number), (span: ReturnType<typeof traceView>['spans'][number]) => span.durationMs)
		),
		ancestors,
		(current, span) => {
			if (HashSet.size(current) >= limit || HashSet.has(current, span.spanId)) return current
			return HashSet.add(current, span.spanId)
		}
	)
	const spans = Array.flatMap(view.spans, span => {
		if (HashSet.has(kept, span.spanId)) return [compactSpan(span)]
		return []
	})
	const logs = Array.map(view.logs, compactLog)
	const omitted = view.spans.length - spans.length
	return {
		at: isoTime(timing.time),
		id,
		ms: rounded(timing.durationMs),
		spans,
		...Option.match(failureSpan, {
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
		...Boolean.match(Array.isReadonlyArrayNonEmpty(logs), {onFalse: () => ({}), onTrue: () => ({logs})}),
		...Boolean.match(omitted > 0, {onFalse: () => ({}), onTrue: () => ({omitted})})
	} satisfies ReadTraceAnswer
}

function severityAtLeast(entry: Pick<Entry, 'payload'>, minimum: number) {
	const recorded = entry.payload['severityNumber']
	if (Predicate.isNumber(recorded)) return recorded >= minimum
	return {debug: 5, error: 17, info: 9, trace: 0, warn: 13}[levelOf(entry)] >= minimum
}

function searchLogsAnswer(entries: readonly Entry[], input: SearchLogsParams, now: number) {
	const cutoff = rangeStart(input.since, now)
	const text = Option.getOrElse(Option.map(Option.fromUndefinedOr(input.text), String.toLowerCase), () => '')
	const levels: Record<NonNullable<SearchLogsParams['level']>, number> = {debug: 5, error: 17, info: 9, warn: 13}
	const minimum = Option.getOrElse(
		Option.map(Option.fromUndefinedOr(input.level), level => levels[level]),
		() => 0
	)
	const traceId = Option.map(Option.fromUndefinedOr(input.trace), String.toLowerCase)
	const matched = Array.filter(entries, entry => {
		if (entry.signal !== 'log' || BigInt(entry.time) < cutoff) return false
		if (input.app !== undefined && appName(entry.service) !== input.app) return false
		if (Option.exists(traceId, wanted => entry.traceId !== wanted)) return false
		if (text !== '' && !String.includes(text)(entryText(entry))) return false
		return input.level === undefined || severityAtLeast(entry, minimum)
	})
	return {
		logs: Array.map(
			Array.take(
				Array.sort(matched, Order.flip(Order.mapInput(Order.BigInt, (entry: Entry) => BigInt(entry.time)))),
				input.limit
			),
			entry => {
				const attrs = attributesFlat(entry.payload, '', false)
				const side = sideOf(entry.service, entry.resource)
				return {
					app: appName(entry.service),
					at: isoTime(entry.time),
					level: levelOf(entry),
					message: entry.name,
					...Option.match(Option.fromUndefinedOr(side), {onNone: () => ({}), onSome: value => ({side: value})}),
					...Boolean.match(entry.traceId !== '', {onFalse: () => ({}), onTrue: () => ({trace: entry.traceId})}),
					...Boolean.match(entry.spanId !== '', {onFalse: () => ({}), onTrue: () => ({span: entry.spanId})}),
					...Option.match(Option.fromUndefinedOr(attrs), {onNone: () => ({}), onSome: value => ({attrs: value})})
				}
			}
		),
		total: matched.length
	} satisfies LogsAnswer
}

function percentile(times: readonly number[], ratio: number) {
	return Option.getOrElse(Array.get(times, Number.max(0, Math.ceil(times.length * ratio) - 1)), () => 0)
}

function measureLatencyAnswer(entries: readonly Entry[], input: MeasureLatencyParams, now: number) {
	const cutoff = rangeStart(input.since, now)
	const spans = Array.filter(
		entries,
		entry =>
			entry.signal === 'trace' &&
			entry.name === input.name &&
			BigInt(entry.time) >= cutoff &&
			(input.app === undefined || appName(entry.service) === input.app)
	)
	const times = Array.sort(
		Array.map(spans, entry => entry.durationMs),
		Order.Number
	)
	return {
		count: spans.length,
		failures: Array.countBy(spans, failed),
		maxMs: rounded(Option.getOrElse(Array.last(times), () => 0)),
		p50Ms: rounded(percentile(times, 0.5)),
		p95Ms: rounded(percentile(times, 0.95))
	} satisfies LatencyAnswer
}

function ingestionAnswer(entries: readonly Entry[], rejections: readonly Rejection[]) {
	const rejected = Array.map(rejections, rejection => ({
		count: rejection.count,
		credential: rejection.credential,
		lastAt: isoMillis(rejection.lastAt),
		route: rejection.route,
		status: rejection.status
	}))
	return {
		services: Array.map(serviceStatuses([...entries]), status => {
			const side = sideFor(status.name, status.runtime)
			return {
				app: appName(status.name),
				entries: status.entries,
				lastEvent: isoTime(status.lastEventAt),
				runStarted: isoTime(status.runStartedAt),
				...Option.match(Option.fromUndefinedOr(side), {onNone: () => ({}), onSome: value => ({side: value})}),
				...Boolean.match(String.isNonEmpty(status.version), {
					onFalse: () => ({}),
					onTrue: () => ({release: status.version})
				})
			}
		}),
		...Boolean.match(Array.isReadonlyArrayNonEmpty(rejected), {
			onFalse: () => ({}),
			onTrue: () => ({rejections: rejected})
		})
	} satisfies IngestionAnswer
}

export class Telemetry extends Context.Service<Telemetry>()('@deslop/scope/services/telemetry/service/Telemetry', {
	make: Effect.fnUntraced(function* (directory: string) {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Entry)
		const random = yield* SecureRandom.SecureRandom
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
		// Spans kept from an older release are named and judged as new ones are, so the previous release's files read the same.
		const state = yield* SynchronizedRef.make<HashMap.HashMap<string, Entry>>(
			HashMap.fromIterable(
				Array.map(Array.getSomes(saved), entry => {
					const derived = {...entry, denied: deniedSpan(entry.payload)}
					if (entry.signal === 'log') return [entry.id, derived] as const
					return [entry.id, {...derived, name: spanName(entry.payload)}] as const
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
		}, failedSave)
		// Open pages share one snapshot, grouped by trace once; without a viewer there is no scan. Changes coalesce during the one-second pause.
		const live = yield* pipe(
			SubscriptionRef.changes(version),
			Stream.buffer({capacity: 1, strategy: 'sliding'}),
			Stream.flatMap(() =>
				Stream.concat(
					Stream.fromEffect(Effect.all({entries: read, now: Clock.currentTimeMillis}, {concurrency: 'unbounded'})),
					Stream.drain(Stream.fromEffect(Effect.sleep('1 second')))
				)
			),
			Stream.map(current => ({...current, traces: tracedOf(current.entries, current.now)})),
			Stream.share({capacity: 1, replay: 1, strategy: 'sliding'})
		)
		return {
			checkIngestion: Effect.fn('Telemetry.checkIngestion')(function* () {
				return ingestionAnswer(yield* read, Record.values(yield* Ref.get(rejections)))
			}),
			findTraces: Effect.fn('Telemetry.findTraces')(function* (input: FindTracesParams) {
				return findTracesAnswer(yield* read, input, yield* Clock.currentTimeMillis)
			}),
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
								denied: false,
								durationMs: 0,
								id,
								name: logMessage(item.log.body ?? {}),
								payload: item.log,
								receivedAt,
								resource: item.group.resource ?? {},
								service: serviceName(item.group.resource ?? {}),
								signal: 'log' as const,
								spanId: String.toLowerCase(item.log.spanId ?? ''),
								status: Boolean.match((item.log.severityNumber ?? 0) >= 17, {
									onFalse: () => 0 as const,
									onTrue: () => 2 as const
								}),
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
								denied: deniedSpan(span),
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
			listOperations: Effect.fn('Telemetry.listOperations')(function* (input: ListOperationsParams) {
				const current = Option.getOrThrow(yield* Stream.runHead(live))
				return operationsAnswer(current.traces, current.now, input)
			}),
			measureLatency: Effect.fn('Telemetry.measureLatency')(function* (input: MeasureLatencyParams) {
				return measureLatencyAnswer(yield* read, input, yield* Clock.currentTimeMillis)
			}),
			// The same snapshot for every viewer; each time frame maps it to its own operations and traces.
			overview: (range: Range) => Stream.map(live, current => overviewOf(current.traces, current.now, range)),
			readTrace: Effect.fn('Telemetry.readTrace')(function* (input: ReadTraceParams) {
				const traceId = String.toLowerCase(input.id)
				const records = Array.filter(yield* read, entry => entry.traceId === traceId)
				if (Array.isReadonlyArrayEmpty(records)) {
					return yield* TelemetryError.make({
						message:
							'No kept telemetry has this trace id: check the id, check ingestion with check_ingestion, or reproduce it if it is older than three days.'
					})
				}
				return readTraceAnswer(records, traceId, input.limit)
			}),
			reject: Effect.fnUntraced(function* (input: Pick<Rejection, 'credential' | 'route' | 'status'>) {
				const now = yield* Clock.currentTimeMillis
				const key = `${input.route}:${input.status}:${input.credential}`
				yield* Ref.update(rejections, current =>
					Record.set(current, key, {...input, count: (current[key]?.count ?? 0) + 1, lastAt: now})
				)
			}),
			searchLogs: Effect.fn('Telemetry.searchLogs')(function* (input: SearchLogsParams) {
				return searchLogsAnswer(yield* read, input, yield* Clock.currentTimeMillis)
			}),
			trace: Effect.fn('Telemetry.trace')(function* (id: string) {
				const traceId = String.toLowerCase(id)
				const records = Array.filter(yield* read, entry => entry.traceId === traceId)
				if (Array.isReadonlyArrayEmpty(records)) {
					return yield* TelemetryError.make({
						message:
							'No kept telemetry has this trace id: check the id, check ingestion with check_ingestion, or reproduce it if it is older than three days.'
					})
				}
				return traceView(records, traceId)
			})
		}
	}, failedSave)
}) {
	static readonly layer = (directory: string) =>
		pipe(Layer.effect(this, this.make(directory)), Layer.provide(layerKeyValueStore(directory)))
}
