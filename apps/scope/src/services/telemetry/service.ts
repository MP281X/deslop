import {
	Array,
	Boolean,
	Clock,
	Context,
	Deferred,
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
	Schema,
	Stream,
	String,
	SubscriptionRef,
	SynchronizedRef,
	pipe
} from 'effect'

import {Digest} from 'effect/crypto'
import {KeyValueStore} from 'effect/persistence'

import {layerKeyValueStore} from '@deslop/runtime/server/store'

import {
	appName,
	attributesFlat,
	brokeAt,
	deniedSpan,
	durationMs,
	entryText,
	failedEntry,
	failureMessage,
	isoMillis,
	isoTime,
	levelOf,
	logMessage,
	machineTimer,
	markedStream,
	newestVersions,
	overviewOf,
	readLinks,
	reconcileReleases,
	retentionOf,
	rounded,
	serviceName,
	serviceStatuses,
	sideFor,
	sideOf,
	spanName,
	subscription,
	traceRoot,
	traceTiming,
	linkedTraces,
	traceView,
	tracedTrace
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
				if (subscription(root, spans) || machineTimer(root)) return Option.none<Candidate>()
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
	const failedSpan = failedEntry(span)
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

function readTraceAnswer(entries: readonly Entry[], id: string, limit: number) {
	const traces = linkedTraces(entries, id)
	const view = traceView([...entries], id)
	const timing = traceTiming(Array.filter(entries, entry => HashSet.has(traces, entry.traceId)))
	const ancestors = Option.match(
		Option.flatMap(Option.fromUndefinedOr(view.failureSpanId), spanId =>
			Array.findFirst(view.spans, span => span.spanId === spanId)
		),
		{
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
		}
	)
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
		...Option.match(Option.fromUndefinedOr(view.failureSpanId), {
			onNone: () => ({}),
			onSome: spanId => ({failure: spanId})
		}),
		id,
		ms: rounded(timing.durationMs),
		spans,
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
			!markedStream(entry) &&
			!machineTimer(entry) &&
			(input.app === undefined || appName(entry.service) === input.app)
	)
	const times = Array.sort(
		Array.map(spans, entry => entry.durationMs),
		Order.Number
	)
	return {
		count: spans.length,
		failures: Array.countBy(spans, failedEntry),
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

// Stored spans are named and judged as new ones are, so the previous release's files read the same.
function deriveEntry(entry: Entry) {
	const links = readLinks(entry.payload)
	const derived = {
		...entry,
		denied: deniedSpan(entry.payload),
		...Boolean.match(Array.isReadonlyArrayNonEmpty(links), {onFalse: () => ({}), onTrue: () => ({links})})
	}
	if (entry.signal === 'log') return derived
	return {...derived, name: spanName(entry.payload)}
}

type State = {
	entries: HashMap.HashMap<string, Entry>
	// Each settled trace derived once, shared by every live snapshot until an ingest touches that trace.
	settled: HashMap.HashMap<string, Traced>
	// Entry ids by service and by trace, so a save reads only the traces it touches and one open trace reads its own rows.
	services: HashMap.HashMap<string, HashSet.HashSet<string>>
	traces: HashMap.HashMap<string, HashSet.HashSet<string>>
	// Span-linked traces either way by edge count, so one open trace loads the traces it joins instead of the store.
	links: HashMap.HashMap<string, HashMap.HashMap<string, number>>
}

function attach(index: HashMap.HashMap<string, HashSet.HashSet<string>>, key: string, id: string) {
	return HashMap.set(
		index,
		key,
		HashSet.add(
			Option.getOrElse(HashMap.get(index, key), () => HashSet.empty<string>()),
			id
		)
	)
}

function detach(index: HashMap.HashMap<string, HashSet.HashSet<string>>, key: string, id: string) {
	const remaining = HashSet.remove(
		Option.getOrElse(HashMap.get(index, key), () => HashSet.empty<string>()),
		id
	)
	if (HashSet.size(remaining) === 0) return HashMap.remove(index, key)
	return HashMap.set(index, key, remaining)
}

function bumpLink(
	links: HashMap.HashMap<string, HashMap.HashMap<string, number>>,
	from: string,
	to: string,
	step: number
) {
	const current = Option.getOrElse(HashMap.get(links, from), () => HashMap.empty<string, number>())
	const count = Option.getOrElse(HashMap.get(current, to), () => 0) + step
	const remaining = Boolean.match(count > 0, {
		onFalse: () => HashMap.remove(current, to),
		onTrue: () => HashMap.set(current, to, count)
	})
	if (HashMap.isEmpty(remaining)) return HashMap.remove(links, from)
	return HashMap.set(links, from, remaining)
}

// A span link joins two traces either way, so both directions count until the entry that carries it goes.
function shiftedLinks(links: HashMap.HashMap<string, HashMap.HashMap<string, number>>, entry: Entry, step: number) {
	return Array.reduce(entry.links ?? [], links, (current, link) => {
		if (link.traceId === entry.traceId) return current
		return bumpLink(bumpLink(current, entry.traceId, link.traceId, step), link.traceId, entry.traceId, step)
	})
}

function removeEntry(state: State, entry: Entry) {
	return {
		entries: HashMap.remove(state.entries, entry.id),
		links: shiftedLinks(state.links, entry, -1),
		services: detach(state.services, entry.service, entry.id),
		settled: Boolean.match(entry.traceId === '', {
			onFalse: () => HashMap.remove(state.settled, entry.traceId),
			onTrue: () => state.settled
		}),
		traces: Boolean.match(entry.traceId === '', {
			onFalse: () => detach(state.traces, entry.traceId, entry.id),
			onTrue: () => state.traces
		})
	}
}

function addEntry(state: State, entry: Entry) {
	const base = Option.match(HashMap.get(state.entries, entry.id), {
		onNone: () => state,
		onSome: existing => removeEntry(state, existing)
	})
	return {
		entries: HashMap.set(base.entries, entry.id, entry),
		links: shiftedLinks(base.links, entry, 1),
		services: attach(base.services, entry.service, entry.id),
		settled: Boolean.match(entry.traceId === '', {
			onFalse: () => HashMap.remove(base.settled, entry.traceId),
			onTrue: () => base.settled
		}),
		traces: Boolean.match(entry.traceId === '', {
			onFalse: () => attach(base.traces, entry.traceId, entry.id),
			onTrue: () => base.traces
		})
	}
}

function traceIdsOf(entries: readonly Entry[]) {
	return Array.flatMap(entries, entry =>
		Boolean.match(entry.traceId === '', {onFalse: () => [entry.traceId], onTrue: () => []})
	)
}

function traceRecords(state: State, traceId: string) {
	return Array.getSomes(
		Array.map(
			Array.fromIterable(Option.getOrElse(HashMap.get(state.traces, traceId), () => HashSet.empty<string>())),
			id => HashMap.get(state.entries, id)
		)
	)
}

function linkedFrom(
	links: HashMap.HashMap<string, HashMap.HashMap<string, number>>,
	frontier: readonly string[],
	found: HashSet.HashSet<string>
): HashSet.HashSet<string> {
	return Array.match(
		Array.dedupe(
			Array.flatMap(frontier, traceId =>
				Array.filter(
					Array.fromIterable(
						HashMap.keys(Option.getOrElse(HashMap.get(links, traceId), () => HashMap.empty<string, number>()))
					),
					linked => !HashSet.has(found, linked)
				)
			)
		),
		{
			onEmpty: () => found,
			onNonEmpty: reached => linkedFrom(links, reached, HashSet.union(found, HashSet.fromIterable(reached)))
		}
	)
}

function settleTrace(state: State, traceId: string, now: number) {
	return Option.match(tracedTrace(traceRecords(state, traceId), now), {
		onNone: () => state,
		onSome: row => ({...state, settled: HashMap.set(state.settled, traceId, row)})
	})
}

function settleTraces(state: State, traceIds: readonly string[], now: number) {
	return Array.reduce(traceIds, state, (current, traceId) => settleTrace(current, traceId, now))
}

// Every cached row, plus the rows that only become visible with age; the live stream calls this once per version.
function snapshotOf(state: State, now: number) {
	const [cached, rows] = Array.mapAccum(
		Array.fromIterable(HashMap.keys(state.traces)),
		state.settled,
		(settled, traceId) =>
			Option.match(HashMap.get(settled, traceId), {
				onNone: () =>
					Option.match(tracedTrace(traceRecords(state, traceId), now), {
						onNone: () => [settled, Option.none<Traced>()] as const,
						onSome: row => [HashMap.set(settled, traceId, row), Option.some(row)] as const
					}),
				onSome: row => [settled, Option.some(row)] as const
			})
	)
	return {rows: Array.getSomes(rows), state: {...state, settled: cached}}
}

export class Telemetry extends Context.Service<Telemetry>()('@deslop/scope/services/telemetry/service/Telemetry', {
	make: Effect.fnUntraced(function* (directory: string) {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Entry)
		const digest = yield* Digest.Digest
		const utf8 = new TextEncoder()
		const rejections = yield* Ref.make(Record.empty<string, Rejection>())
		// Bumped when traces arrive, expire or finish loading, so the live page recomputes only when its rows can change.
		const version = yield* SubscriptionRef.make(0)
		// Completed once the previous run's store has loaded and settled.
		const loaded = yield* Deferred.make<void>()
		// Each service's newest release seen: what an older one sent may describe a bug since fixed, so it goes.
		const releases = yield* Ref.make(Record.empty<string, string>())
		const state = yield* SynchronizedRef.make<State>({
			entries: HashMap.empty(),
			links: HashMap.empty(),
			services: HashMap.empty(),
			settled: HashMap.empty(),
			traces: HashMap.empty()
		})
		// A development debugger needs recent runs of the current release; older entries would only slow every start and query.
		const prune = Effect.gen(function* () {
			const receivedAt = yield* Clock.currentTimeMillis
			yield* SynchronizedRef.updateEffect(
				state,
				Effect.fnUntraced(function* (current) {
					const retention = retentionOf(
						current.entries,
						yield* Ref.get(releases),
						receivedAt,
						Duration.toMillis(RETENTION)
					)
					yield* Effect.forEach(retention.repaired, entry => store.set(entry.id, entry), {
						concurrency: 1,
						discard: true
					})
					yield* Effect.forEach(retention.expired, entry => store.remove(entry.id), {concurrency: 1, discard: true})
					// Retention only repairs receipt times and removes whole expired traces, so the indexes stay as they are.
					return {
						entries: retention.next,
						links: Array.reduce(retention.expired, current.links, (links, entry) => shiftedLinks(links, entry, -1)),
						services: Array.reduce(retention.expired, current.services, (index, entry) =>
							detach(index, entry.service, entry.id)
						),
						settled: Array.reduce(Array.dedupe(traceIdsOf(retention.expired)), current.settled, (settled, traceId) =>
							HashMap.remove(settled, traceId)
						),
						traces: Array.reduce(retention.expired, current.traces, (index, entry) =>
							Boolean.match(entry.traceId === '', {
								onFalse: () => detach(index, entry.traceId, entry.id),
								onTrue: () => index
							})
						)
					}
				})
			)
			yield* SubscriptionRef.update(version, Number.increment)
		})
		// The layer answers at once; the stores of the previous run arrive in the background and merge under any ingest that lands meanwhile.
		yield* pipe(
			Effect.gen(function* () {
				const entries = Array.getSomes(
					yield* Effect.forEach(
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
				)
				// An ingest during the load already replaced what the disk holds; its newer entry stays.
				const now = yield* Clock.currentTimeMillis
				yield* SynchronizedRef.update(state, current => {
					const merged = Array.reduce(entries, current, (all, entry) => {
						const derived = deriveEntry(entry)
						if (HashMap.has(all.entries, derived.id)) return all
						return addEntry(all, derived)
					})
					return settleTraces(merged, Array.fromIterable(HashMap.keys(merged.traces)), now)
				})
				yield* Ref.update(releases, known => newestVersions(entries, known))
			}),
			Effect.ignore({log: 'Warn', message: 'Stored telemetry could not be loaded'}),
			Effect.andThen(prune),
			Effect.ignore({log: 'Warn', message: 'Expired telemetry could not be deleted'}),
			Effect.andThen(Deferred.succeed(loaded, undefined)),
			Effect.andThen(
				Effect.forever(
					pipe(
						Effect.sleep('1 hour'),
						Effect.andThen(prune),
						Effect.ignore({log: 'Warn', message: 'Expired telemetry could not be deleted'})
					)
				)
			),
			Effect.forkScoped
		)
		const read = Effect.map(SynchronizedRef.get(state), current => Array.fromIterable(HashMap.values(current.entries)))
		// What an older release sends is dropped; a newer release's first entries delete everything its service's older ones sent.
		const save = Effect.fnUntraced(function* (entries: Entry[], receivedAt: number) {
			yield* Effect.uninterruptible(
				SynchronizedRef.updateEffect(
					state,
					Effect.fnUntraced(function* (current) {
						const reconciliation = reconcileReleases(
							traceId =>
								Array.getSomes(
									Array.map(
										Array.fromIterable(
											Option.getOrElse(HashMap.get(current.traces, traceId), () => HashSet.empty<string>())
										),
										id => HashMap.get(current.entries, id)
									)
								),
							service =>
								Array.getSomes(
									Array.map(
										Array.fromIterable(
											Option.getOrElse(HashMap.get(current.services, service), () => HashSet.empty<string>())
										),
										id => HashMap.get(current.entries, id)
									)
								),
							entries,
							yield* Ref.get(releases)
						)
						yield* Effect.forEach(reconciliation.replaced, entry => store.remove(entry.id), {
							concurrency: 1,
							discard: true
						})
						yield* Effect.forEach(reconciliation.accepted, entry => store.set(entry.id, entry), {
							concurrency: 1,
							discard: true
						})
						yield* Ref.set(releases, reconciliation.newest)
						return settleTraces(
							Array.reduce(
								reconciliation.accepted,
								Array.reduce(reconciliation.replaced, current, removeEntry),
								addEntry
							),
							Array.dedupe(traceIdsOf([...reconciliation.accepted, ...reconciliation.replaced])),
							receivedAt
						)
					})
				)
			)
			yield* SubscriptionRef.update(version, Number.increment)
		}, failedSave)
		// Open pages share one snapshot of the settled rows; only a trace an ingest touched is derived again. Changes coalesce during the one-second pause.
		const live = yield* pipe(
			SubscriptionRef.changes(version),
			Stream.buffer({capacity: 1, strategy: 'sliding'}),
			Stream.flatMap(() =>
				Stream.concat(
					Stream.fromEffect(
						Effect.gen(function* () {
							const now = yield* Clock.currentTimeMillis
							const traces = yield* SynchronizedRef.modify(state, current => {
								const snapshot = snapshotOf(current, now)
								return [snapshot.rows, snapshot.state]
							})
							return {now, traces}
						})
					),
					Stream.drain(Stream.fromEffect(Effect.sleep('1 second')))
				)
			),
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
							Effect.flatMap(
								// A log record has no id of its own, so the identity is what it carries: a retried export replaces its entry instead of adding one.
								pipe(
									Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
										attributes: item.log.attributes ?? [],
										body: item.log.body ?? {},
										observedTimeUnixNano: item.log.observedTimeUnixNano ?? '',
										resource: item.group.resource ?? {},
										severityNumber: item.log.severityNumber,
										severityText: item.log.severityText ?? '',
										spanId: item.log.spanId ?? '',
										timeUnixNano: item.log.timeUnixNano,
										traceId: item.log.traceId ?? ''
									}),
									Effect.mapError(cause => TelemetryError.make({cause, message: 'A log record could not be encoded.'}))
								),
								encoded =>
									Effect.map(digest.digestHex(Digest.sha256, utf8.encode(encoded)), id =>
										deriveEntry({
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
										})
									)
							),
						{concurrency: 1}
					),
					receivedAt
				)
			}),
			ingestTraces: Effect.fn('Telemetry.ingestTraces')(function* (payload: TracesRequest) {
				const receivedAt = yield* Clock.currentTimeMillis
				yield* save(
					Array.flatMap(payload.resourceSpans ?? [], group =>
						Array.flatMap(group.scopeSpans ?? [], scope =>
							Array.map(scope.spans ?? [], span =>
								deriveEntry({
									durationMs: durationMs(span.startTimeUnixNano, span.endTimeUnixNano ?? '0'),
									id: `${String.toLowerCase(span.traceId)}:${String.toLowerCase(span.spanId)}`,
									name: '',
									payload: span,
									receivedAt,
									resource: group.resource ?? {},
									service: serviceName(group.resource ?? {}),
									signal: 'trace' as const,
									spanId: String.toLowerCase(span.spanId),
									status: span.status?.code ?? 0,
									time: span.startTimeUnixNano,
									traceId: String.toLowerCase(span.traceId)
								})
							)
						)
					),
					receivedAt
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
				const entries = yield* read
				if (!Array.some(entries, entry => entry.traceId === traceId)) {
					return yield* TelemetryError.make({
						message:
							'No kept telemetry has this trace id: check the id, check ingestion with check_ingestion, or reproduce it if it is older than three days.'
					})
				}
				return readTraceAnswer(entries, traceId, input.limit)
			}),
			ready: Deferred.await(loaded),
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
				const current = yield* SynchronizedRef.get(state)
				if (Array.isReadonlyArrayEmpty(traceRecords(current, traceId))) {
					return yield* TelemetryError.make({
						message:
							'No kept telemetry has this trace id: check the id, check ingestion with check_ingestion, or reproduce it if it is older than three days.'
					})
				}
				// The trace and every trace a span link joins to it, either way, read from the link index.
				return traceView(
					Array.flatMap(Array.fromIterable(linkedFrom(current.links, [traceId], HashSet.make(traceId))), linked =>
						traceRecords(current, linked)
					),
					traceId
				)
			})
		}
	}, failedSave)
}) {
	static readonly layer = (directory: string) =>
		pipe(Layer.effect(this, this.make(directory)), Layer.provide(layerKeyValueStore(directory)))
}
