import {
	Array,
	Boolean,
	Context,
	DateTime,
	Duration,
	Effect,
	HashSet,
	Layer,
	Number,
	Option,
	Order,
	Predicate,
	Record,
	Ref,
	Schema,
	Schedule,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {Digest} from 'effect/crypto'
import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {
	appName,
	attributesFlat,
	diagnosis,
	latencyOf,
	levelOf,
	logOf,
	newestReleases,
	overviewOf,
	sideOf,
	senderOf,
	spansOf,
	supersededBy,
	touchedTraces,
	traceIdsOf,
	traceTree
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
	Overview,
	Range,
	ReadTraceAnswer,
	ReadTraceParams,
	Rejection,
	SearchLogsParams,
	TraceRow,
	TracesAnswer,
	TracesRequest,
	AppName,
	ServiceName,
	SpanId,
	ReleaseVersion
} from '#services/telemetry/schema.ts'
import {
	FoundTrace,
	ExportedLog,
	LatencyQuery,
	Log,
	LogId,
	LogQuery,
	McpServerName,
	McpToolName,
	rangeStart,
	Release,
	Resource,
	ServiceRun,
	SettledTrace,
	Span,
	SpanLink,
	Superseded,
	TelemetryError,
	Trace,
	TraceDetail,
	TraceId,
	TraceQuery,
	TraceTree
} from '#services/telemetry/schema.ts'

const MISSING =
	'No kept telemetry has this trace id: check the id, check ingestion with check_ingestion, or reproduce it if it is older than three days.'

const UNAVAILABLE = 'The telemetry storage could not be read or written.'

const LEVELS = {debug: 5, error: 17, info: 9, warn: 13}

// The span columns an arriving copy of a stored span replaces; its trace and id stay.
const SPAN_UPDATES = Array.filter(
	Struct.keys(Span.insert.fields),
	column => column !== 'traceId' && column !== 'spanId'
)

// The trace columns a new span changes; when the trace first arrived stays.
const TRACE_UPDATES = Array.filter(
	Struct.keys(Trace.insert.fields),
	column => column !== 'id' && column !== 'receivedAt'
)

const asTelemetryError = Effect.mapError((cause: unknown) => TelemetryError.make({cause, message: UNAVAILABLE}))

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly telemetry: never
	}
}

// Rows written in statements of 500, well under SQLite's limit on one statement's parameters.
function chunked<A, E>(rows: readonly A[], save: (chunk: Array.NonEmptyReadonlyArray<A>) => Effect.Effect<void, E>) {
	return pipe(rows, Array.chunksOf(500), Effect.forEach(save, {concurrency: 1, discard: true}))
}

function tracedOf(row: SettledTrace) {
	return {
		app: appName(row.service),
		failed: row.failed,
		name: row.name,
		runtime: row.runtime,
		trace: {duration: row.duration, failure: Option.none(), id: row.id, label: Option.none(), start: row.start}
	} satisfies Traced
}

// The overview's kept traces with their labels and failures; a trace pruned since the overview counted it stays without them until the next read.
function detailed(overview: Overview, rows: readonly TraceDetail[]) {
	const byId = Record.fromEntries(Array.map(rows, row => [row.id, row] as const))
	return {
		apps: Array.map(overview.apps, app => ({
			...app,
			operations: Array.map(app.operations, operation => ({
				...operation,
				traces: Array.map(operation.traces, trace =>
					pipe(
						byId,
						Record.get(trace.id),
						Option.match({
							onNone: () => trace,
							onSome: row => {
								const error = diagnosis(row)
								return {...trace, failure: Option.map(row.broken, span => ({error, span})), label: row.label}
							}
						})
					)
				)
			}))
		}))
	} satisfies Overview
}

// Failing traces above the rest, then the newest: the largest is an operation's newest failure when it has one.
const newestFailureLast = pipe(
	Order.Boolean,
	Order.mapInput((trace: OperationTrace) => Option.isSome(trace.failure)),
	Order.combine(Order.mapInput(DateTime.Order, (trace: OperationTrace) => trace.start))
)

// The newest failing trace an operation keeps, whose span and message the tools show; its kept traces hold its newest failures.
function latestFailure(operation: Operation) {
	const newest = Array.max(operation.traces, newestFailureLast)
	return Option.map(newest.failure, failure => ({...failure, trace: newest.id}))
}

// The page's own operations for one frame, in the overview's order, with the numbers the tools need.
function operationsAnswer(overview: Overview, name: Option.Option<AppName>) {
	const apps = pipe(
		overview.apps,
		Array.filter(app => Option.match(name, {onNone: () => true, onSome: value => app.name === value})),
		Array.map(app => ({
			app: app.name,
			operations: Array.map(app.operations, operation => {
				const side = sideOf(app.name, operation.runtime)
				return {
					failure: latestFailure(operation),
					failures: Option.liftPredicate(operation.failures, count => count > 0),
					name: operation.name,
					p50Ms: Duration.millis(Number.round(Duration.toMillis(operation.p50Ms), 1)),
					p95Ms: Duration.millis(Number.round(Duration.toMillis(operation.p95Ms), 1)),
					runs: operation.count,
					side,
					slowest: Array.headNonEmpty(operation.traces).id
				} satisfies OperationRow
			})
		}))
	)
	return {apps: Array.filter(apps, app => Array.isReadonlyArrayNonEmpty(app.operations))} satisfies OperationsAnswer
}

function traceRow(row: FoundTrace) {
	const side = sideOf(row.service, row.runtime)
	const relay = Option.flatMap(row.relay, attributes => attributesFlat(attributes, 'Gateway.call', false))
	const error = diagnosis(row)
	return {
		app: appName(row.service),
		at: row.start,
		failure: Option.map(row.broken, span =>
			Option.match(error, {onNone: () => span, onSome: message => `${span}: ${message}`})
		),
		id: row.id,
		ms: Duration.millis(Number.round(Duration.toMillis(row.duration), 1)),
		operation: row.name,
		server: pipe(
			relay,
			Option.flatMap(Record.get('mcp.server')),
			Option.filter(Predicate.isString),
			Option.map(name => McpServerName.make(name))
		),
		side,
		spans: row.spans,
		tool: pipe(
			relay,
			Option.flatMap(Record.get('mcp.tool')),
			Option.filter(Predicate.isString),
			Option.map(name => McpToolName.make(name))
		)
	} satisfies TraceRow
}

function compactLog(log: Pick<Log, 'message' | 'severity' | 'time'>) {
	return {at: log.time, level: levelOf(log.severity), message: log.message} satisfies CompactLog
}

type TreeSpan = TraceTree['spans'][number]

function compactSpan(span: TreeSpan) {
	const failedSpan = span.status === 'failed'
	const error = Option.filter(diagnosis(span), () => failedSpan)
	const attrs = attributesFlat(span.attributes, span.name, failedSpan)
	const side = sideOf(span.service, span.runtime)
	const logs = Array.map(span.logs, compactLog)
	return {
		app: appName(span.service),
		at: Duration.millis(Number.round(Duration.toMillis(span.offsetMs), 1)),
		attrs,
		denied: Option.liftPredicate(true, () => span.status === 'denied'),
		error,
		id: span.spanId,
		logs: Option.liftPredicate(logs, Array.isReadonlyArrayNonEmpty),
		ms: Duration.millis(Number.round(Duration.toMillis(span.durationMs), 1)),
		name: span.name,
		parent: span.parentSpanId,
		side
	}
}

// Where a tree starts: its earliest span, or its earliest log when no span arrived.
function startOf(tree: TraceTree) {
	return pipe(
		tree.spans,
		Array.map(span => span.start),
		Array.match({
			onEmpty: () => Option.map(Array.head(tree.logs), log => log.time),
			onNonEmpty: starts => Option.some(Array.min<DateTime.Utc>(starts, DateTime.Order))
		})
	)
}

function readTraceAnswer(
	tree: TraceTree,
	limit: number,
	offset: number,
	details: boolean,
	selectedSpanId: Option.Option<SpanId>
) {
	const byId = Record.fromEntries(Array.map(tree.spans, span => [span.spanId, span] as const))
	// The failing span and its parents up to the root, stopping at a parent already walked.
	const ancestors = HashSet.fromIterable(
		Array.unfold({id: tree.failureSpanId, seen: HashSet.empty<SpanId>()}, current =>
			pipe(
				current.id,
				Option.filter(id => !HashSet.has(current.seen, id)),
				Option.flatMap(id =>
					pipe(
						byId,
						Record.get(id),
						Option.map(found => [found.spanId, {id: found.parentSpanId, seen: HashSet.add(current.seen, id)}])
					)
				)
			)
		)
	)
	const candidates = pipe(
		tree.spans,
		Array.sort(Order.mapInput(Order.flip(Duration.Order), (span: TreeSpan) => span.durationMs)),
		Array.filter(span => !HashSet.has(ancestors, span.spanId))
	)
	const kept = HashSet.union(
		ancestors,
		HashSet.fromIterable(
			pipe(
				candidates,
				Array.drop(offset),
				Array.take(limit),
				Array.map(span => span.spanId)
			)
		)
	)
	const spans = Array.flatMap(tree.spans, span => {
		if (Option.isSome(selectedSpanId)) {
			return pipe(
				selectedSpanId,
				Option.contains(span.spanId),
				Boolean.match({onFalse: () => [], onTrue: () => [compactSpan(span)]})
			)
		}
		if (details || HashSet.has(kept, span.spanId)) return [compactSpan(span)]
		return []
	})
	const logs = Array.map(tree.logs, compactLog)
	const omitted = tree.spans.length - spans.length
	return {
		at: Option.getOrThrow(startOf(tree)),
		failure: tree.failureSpanId,
		id: tree.id,
		logs: Option.liftPredicate(logs, Array.isReadonlyArrayNonEmpty),
		ms: Duration.millis(Number.round(Duration.toMillis(tree.durationMs), 1)),
		nextOffset: Option.liftPredicate(offset + limit, next => next < candidates.length),
		omitted: Option.liftPredicate(omitted, count => count > 0),
		spans
	} satisfies ReadTraceAnswer & {nextOffset: Option.Option<number>}
}

function pageOf<A>(rows: readonly A[], limit: number) {
	const items = Array.take(rows, limit)
	return {items, last: Option.filter(Array.last(items), () => rows.length > limit)}
}

export class Telemetry extends Context.Service<Telemetry>()('@deslop/scope/services/telemetry/service/Telemetry', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const digest = yield* Digest.Digest
		const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)
		const utf8 = new TextEncoder()
		const rejections = yield* Ref.make(Record.empty<string, Rejection>())

		// The traces a query selects; its text matches a span's name, attributes or error, or one of its logs, never its ids or times.
		function filterTraces(query: typeof TraceQuery.Encoded) {
			return sql.and([
				sql`NOT traces.waits`,
				sql`traces.start >= ${query.cutoff}`,
				...Array.getSomes([
					Option.map(Option.fromNullOr(query.services), services => sql`root.service IN ${sql.in(services)}`),
					Option.map(Option.fromNullOr(query.operation), name => sql`root.name = ${name}`),
					Option.map(
						Option.fromNullOr(query.span),
						name => sql`EXISTS (SELECT 1 FROM spans AS named WHERE named.traceId = traces.id AND named.name = ${name})`
					),
					Option.map(
						Option.fromNullOr(query.text),
						text => sql`(
							EXISTS (
								SELECT 1 FROM spans AS said WHERE said.traceId = traces.id
								AND instr(lower(concat_ws(' ', said.name, said.attributes, said.error, said.exception)), ${text}) > 0
							)
							OR EXISTS (
								SELECT 1 FROM logs WHERE logs.traceId = traces.id
								AND instr(lower(concat_ws(' ', logs.message, logs.attributes)), ${text}) > 0
							)
						)`
					),
					Option.liftPredicate(sql`traces.broken IS NOT NULL`, () => query.errors)
				])
			])
		}
		function filterLogs(query: typeof LogQuery.Encoded) {
			return sql.and([
				sql`time >= ${query.cutoff}`,
				...Array.getSomes([
					Option.map(Option.fromNullOr(query.services), services => sql`service IN ${sql.in(services)}`),
					Option.map(Option.fromNullOr(query.traceId), traceId => sql`traceId = ${traceId}`),
					Option.map(
						Option.fromNullOr(query.text),
						text => sql`instr(lower(concat_ws(' ', message, attributes)), ${text}) > 0`
					),
					Option.map(Option.fromNullOr(query.minimum), minimum => sql`severity >= ${minimum}`)
				])
			])
		}
		// The trace's root and where it broke, beside the trace itself.
		const traceJoins = sql`
			FROM traces
			JOIN spans AS root ON root.traceId = traces.id AND root.spanId = traces.root
			LEFT JOIN spans AS broken ON broken.traceId = traces.id AND broken.spanId = traces.broken
		`

		const listReleases = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Release,
			execute: () => sql`SELECT * FROM ${sql(Release.table)}`
		})
		const saveReleases = SqlSchema.void({
			Request: Schema.NonEmptyArray(Release.insert),
			execute: rows => sql`
				INSERT INTO ${sql(Release.table)} ${sql.insert(rows)}
				ON CONFLICT (service) DO UPDATE SET version = excluded.version
			`
		})
		const listSenders = SqlSchema.findAll({
			Request: Schema.Array(Span.fields.service),
			Result: Schema.Struct(Struct.pick(Span.fields, ['service', 'version'])),
			execute: services => sql`
				SELECT DISTINCT service, version FROM spans WHERE ${sql.in('service', services)}
				UNION
				SELECT DISTINCT service, version FROM logs WHERE ${sql.in('service', services)}
			`
		})
		// A trace goes when every span and log it holds came from a superseded release; a standalone log goes on its own.
		const deleteSuperseded = SqlSchema.void({
			Request: Schema.NonEmptyArray(Superseded),
			execute: senders => {
				const old = sql.or(
					Array.map(senders, sender => sql`(service = ${sender.service} AND version = ${sender.version})`)
				)
				const doomed = sql`
					SELECT traceId FROM (
						SELECT traceId, service, version FROM spans
						UNION ALL
						SELECT traceId, service, version FROM logs WHERE traceId IS NOT NULL
					)
					GROUP BY traceId
					HAVING min(CASE WHEN ${old} THEN 1 ELSE 0 END) = 1
				`
				return Effect.andThen(
					sql`DELETE FROM logs WHERE traceId IN (${doomed}) OR (traceId IS NULL AND ${old})`,
					sql`DELETE FROM traces WHERE id IN (${doomed})`
				)
			}
		})
		const listSpans = SqlSchema.findAll({
			Request: Schema.Array(TraceId),
			Result: Span,
			execute: ids => sql`SELECT * FROM ${sql(Span.table)} WHERE ${sql.in('traceId', ids)}`
		})
		const listLogs = SqlSchema.findAll({
			Request: Schema.Array(TraceId),
			Result: Log,
			execute: ids => sql`SELECT * FROM ${sql(Log.table)} WHERE ${sql.in('traceId', ids)}`
		})
		const listLinks = SqlSchema.findAll({
			Request: Schema.Array(TraceId),
			Result: SpanLink,
			execute: ids => sql`SELECT * FROM ${sql(SpanLink.table)} WHERE ${sql.in('traceId', ids)}`
		})
		// The trace and every trace a span link joins to it, either way.
		const listLinkedTraces = SqlSchema.findAll({
			Request: TraceId,
			Result: Schema.Struct({id: TraceId}),
			execute: id => sql`
				WITH RECURSIVE linked (id) AS (
					SELECT ${id}
					UNION
					SELECT span_links.linkedTraceId FROM span_links JOIN linked ON span_links.traceId = linked.id
					UNION
					SELECT span_links.traceId FROM span_links JOIN linked ON span_links.linkedTraceId = linked.id
				)
				SELECT id FROM linked
			`
		})
		const saveTraces = SqlSchema.void({
			Request: Schema.NonEmptyArray(Trace.insert),
			execute: rows => sql`
				INSERT INTO ${sql(Trace.table)} ${sql.insert(rows)}
				ON CONFLICT (id) DO UPDATE SET ${sql.csv(Array.map(TRACE_UPDATES, column => sql`${sql(column)} = excluded.${sql(column)}`))}
			`
		})
		// A retried export or a finished run sends a span again; the newer copy replaces the stored one.
		const saveSpans = SqlSchema.void({
			Request: Schema.NonEmptyArray(Span.insert),
			execute: rows => sql`
				INSERT INTO ${sql(Span.table)} ${sql.insert(rows)}
				ON CONFLICT (traceId, spanId) DO UPDATE SET ${sql.csv(Array.map(SPAN_UPDATES, column => sql`${sql(column)} = excluded.${sql(column)}`))}
			`
		})
		const saveLinks = SqlSchema.void({
			Request: Schema.NonEmptyArray(SpanLink.insert),
			execute: rows => sql`INSERT OR IGNORE INTO ${sql(SpanLink.table)} ${sql.insert(rows)}`
		})
		// A retried export carries the same record, so its digest replaces the row instead of adding one.
		const saveLogs = SqlSchema.void({
			Request: Schema.NonEmptyArray(Log.insert),
			execute: rows => sql`INSERT OR REPLACE INTO ${sql(Log.table)} ${sql.insert(rows)}`
		})
		// A development debugger needs recent runs; whole traces go once their first span is older than the cutoff, with their logs.
		const deleteExpired = SqlSchema.void({
			Request: Log.fields.receivedAt,
			execute: cutoff =>
				Effect.andThen(
					sql`
						DELETE FROM logs
						WHERE receivedAt < ${cutoff} OR traceId IN (SELECT id FROM traces WHERE receivedAt < ${cutoff})
					`,
					sql`DELETE FROM traces WHERE receivedAt < ${cutoff}`
				)
		})
		// Every trace the operations list can show: not a wait, and rooted or a minute old, since its root may never come.
		const listSettled = SqlSchema.findAll({
			Request: Schema.Struct({cutoff: Span.fields.start, settledBefore: Span.fields.start}),
			Result: SettledTrace,
			execute: query => sql`
				SELECT
					traces.id, traces.start, traces.duration, root.service, root.runtime, root.name,
					traces.broken IS NOT NULL AS failed
				${traceJoins}
				WHERE NOT traces.waits AND traces.start >= ${query.cutoff}
				AND (traces.rooted OR traces.start < ${query.settledBefore})
			`
		})
		// The label and failure of the traces the overview keeps, read for them alone.
		const listDetails = SqlSchema.findAll({
			Request: Schema.Array(TraceId),
			Result: TraceDetail,
			execute: ids => sql`
				SELECT
					traces.id,
					CASE WHEN json_type(root.attributes, '$."trace.label"') = 'text'
						THEN json_extract(root.attributes, '$."trace.label"')
					END AS label,
					broken.name AS broken, broken.error, broken.exception
				${traceJoins}
				WHERE ${sql.in('traces.id', ids)}
			`
		})
		const listServices = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Schema.Struct(Struct.pick(Span.fields, ['service'])),
			execute: () => sql`SELECT DISTINCT service FROM spans UNION SELECT DISTINCT service FROM logs`
		})
		// One page of traces, newest or slowest first, after the cursor's row; one more than asked tells whether a next page exists.
		const pageTraces = SqlSchema.findAll({
			Request: TraceQuery,
			Result: FoundTrace,
			execute: query => {
				const after = Option.match(Option.fromNullOr(query.cursor), {
					onNone: () => sql`1=1`,
					onSome: cursor =>
						Boolean.match(query.slowest, {
							onFalse: () =>
								sql`(traces.start < ${cursor.start} OR (traces.start = ${cursor.start} AND traces.id < ${cursor.id}))`,
							onTrue: () =>
								sql`(traces.duration < ${cursor.duration} OR (traces.duration = ${cursor.duration} AND traces.id < ${cursor.id}))`
						})
				})
				return sql`
					SELECT
						traces.id, traces.start, traces.duration, root.service, root.runtime, root.name,
						broken.name AS broken, broken.error, broken.exception,
						(SELECT count(*) FROM spans AS counted WHERE counted.traceId = traces.id) AS spans,
						(
							SELECT relay.attributes FROM spans AS relay
							WHERE relay.traceId = traces.id AND relay.name = 'Gateway.call' LIMIT 1
						) AS relay
					${traceJoins}
					WHERE ${filterTraces(query)} AND ${after}
					ORDER BY ${Boolean.match(query.slowest, {onFalse: () => sql`traces.start DESC`, onTrue: () => sql`traces.duration DESC`})}, traces.id DESC
					LIMIT ${query.limit + 1}
				`
			}
		})
		const countTraces = SqlSchema.findOne({
			Request: TraceQuery,
			Result: Schema.Struct({count: Schema.Int}),
			execute: query => sql`SELECT count(*) AS count ${traceJoins} WHERE ${filterTraces(query)}`
		})
		const pageLogs = SqlSchema.findAll({
			Request: LogQuery,
			Result: Log,
			execute: query => {
				const after = Option.match(Option.fromNullOr(query.cursor), {
					onNone: () => sql`1=1`,
					onSome: cursor => sql`(time < ${cursor.time} OR (time = ${cursor.time} AND id > ${cursor.id}))`
				})
				return sql`
					SELECT * FROM logs
					WHERE ${filterLogs(query)} AND ${after}
					ORDER BY time DESC, id
					LIMIT ${query.limit + 1}
				`
			}
		})
		const countLogs = SqlSchema.findOne({
			Request: LogQuery,
			Result: Schema.Struct({count: Schema.Int}),
			execute: query => sql`SELECT count(*) AS count FROM logs WHERE ${filterLogs(query)}`
		})
		// The spans of one name that measure work: a subscription's stream and a machine's timer are waits.
		const listLatencies = SqlSchema.findAll({
			Request: LatencyQuery,
			Result: Schema.Struct(Struct.pick(Span.fields, ['duration', 'status'])),
			execute: query => sql`
				SELECT duration, status FROM spans
				WHERE name = ${query.name} AND start >= ${query.cutoff}
				AND ${Option.match(Option.fromNullOr(query.services), {
					onNone: () => sql`1=1`,
					onSome: services => sql`service IN ${sql.in(services)}`
				})}
				AND json_extract(attributes, '$."rpc.stream"') IS NOT 1
				AND json_extract(attributes, '$."machine.invoke.kind"') IS NOT 'Timer'
			`
		})
		const listRuns = SqlSchema.findAll({
			Request: Schema.Void,
			Result: ServiceRun,
			execute: () => sql`
				WITH
					entries AS (
						SELECT service, runtime, run, version, start AS time FROM spans
						UNION ALL
						SELECT service, runtime, run, version, time FROM logs
					),
					latest AS (SELECT service, max(coalesce(run, 0)) AS run FROM entries GROUP BY service)
				SELECT
					entries.service, count(*) AS entries, max(entries.time) AS lastEvent,
					max(entries.run) AS run, max(entries.runtime) AS runtime, max(entries.version) AS version
				FROM entries JOIN latest ON latest.service = entries.service AND coalesce(entries.run, 0) = latest.run
				GROUP BY entries.service
				ORDER BY entries.service
			`
		})

		// The services an app's name covers, or every service when none is asked for.
		const servicesOf = Effect.fnUntraced(function* (app: Option.Option<AppName>) {
			if (Option.isNone(app)) return Option.none<readonly ServiceName[]>()
			return Option.some(
				pipe(
					yield* listServices(),
					Array.map(row => row.service),
					Array.filter(service => Option.contains(app, appName(service)))
				)
			)
		})
		// What an older release sends is dropped; a newer release's first records delete everything its service's older ones sent.
		const supersede = Effect.fnUntraced(function* (
			senders: readonly {service: ServiceName; version: Option.Option<ReleaseVersion>}[]
		) {
			const known = Record.fromEntries(Array.map(yield* listReleases(), row => [row.service, row.version] as const))
			const newest = newestReleases(senders, known)
			const changed = Array.map(
				Record.toEntries(Record.filter(newest, (version, service) => known[service] !== version)),
				entry => ({service: entry[0], version: entry[1]})
			)
			yield* Array.match(changed, {onEmpty: () => Effect.void, onNonEmpty: saveReleases})
			const superseded = supersededBy(newest)
			const services = Array.dedupe([
				...Array.map(changed, release => release.service),
				...pipe(
					senders,
					Array.filter(superseded),
					Array.map(sender => sender.service)
				)
			])
			if (Array.isReadonlyArrayEmpty(services)) return
			yield* Array.match(
				Array.getSomes(
					pipe(
						yield* listSenders(services),
						Array.filter(superseded),
						Array.map(sender => Option.map(sender.version, version => ({service: sender.service, version})))
					)
				),
				{onEmpty: () => Effect.void, onNonEmpty: deleteSuperseded}
			)
		})
		// Three days of telemetry: a development debugger needs recent runs, and older ones would slow every query.
		const prune = pipe(
			DateTime.now,
			Effect.flatMap(now => deleteExpired(DateTime.subtractDuration(now, Duration.days(3)))),
			Reactivity.mutation(['telemetry']),
			sql.withTransaction,
			asTelemetryError,
			withReactivity,
			Effect.withSpan('Telemetry.prune')
		)
		// The overview as of now, counted over every settled trace; a trace whose root never came joins it a minute after it started.
		const readOverview = Effect.fnUntraced(function* (range: Range) {
			const now = yield* DateTime.now
			const counted = overviewOf(
				Array.map(
					yield* listSettled({
						cutoff: rangeStart(range, now),
						settledBefore: DateTime.subtractDuration(now, Duration.minutes(1))
					}),
					tracedOf
				),
				now,
				range
			)
			return detailed(
				counted,
				yield* listDetails(
					Array.flatMap(counted.apps, app =>
						Array.flatMap(app.operations, operation => Array.map(operation.traces, trace => trace.id))
					)
				)
			)
		})
		const tree = Effect.fnUntraced(function* (id: TraceId) {
			const traceId = TraceId.make(String.toLowerCase(id))
			const ids = Array.map(yield* listLinkedTraces(traceId), row => row.id)
			const spans = yield* listSpans(ids)
			const logs = yield* listLogs(ids)
			if (Array.isReadonlyArrayEmpty(spans) && Array.isReadonlyArrayEmpty(logs)) {
				return yield* TelemetryError.make({message: MISSING})
			}
			return traceTree(traceId, spans, logs, yield* listLinks(ids))
		})

		yield* prune
		yield* pipe(
			prune,
			Effect.ignore({log: 'Error', message: 'Expired telemetry could not be deleted'}),
			Effect.schedule(Schedule.spaced(Duration.hours(1))),
			Effect.forkScoped
		)

		return {
			checkIngestion: Effect.fn('Telemetry.checkIngestion')(function* () {
				const rejected = Array.map(Record.values(yield* Ref.get(rejections)), rejection => ({
					...Struct.pick(rejection, ['count', 'credential', 'route', 'status']),
					lastAt: rejection.lastAt
				}))
				return {
					rejections: Option.liftPredicate(rejected, Array.isReadonlyArrayNonEmpty),
					services: Array.map(yield* listRuns(), run => {
						const side = sideOf(run.service, run.runtime)
						return {
							app: appName(run.service),
							entries: run.entries,
							lastEvent: run.lastEvent,
							release: run.version,
							runStarted: run.run,
							side
						}
					})
				} satisfies IngestionAnswer
			}, asTelemetryError),
			findTraces: Effect.fn('Telemetry.findTraces')(function* (input: FindTracesParams) {
				const query = {
					cursor: input.cursor,
					cutoff: rangeStart(input.since, yield* DateTime.now),
					errors: input.errors,
					limit: input.limit,
					operation: input.operation,
					services: yield* servicesOf(input.app),
					slowest: input.sort === 'slowest',
					span: input.span,
					text: Option.map(input.text, String.toLowerCase)
				} satisfies TraceQuery
				const page = pageOf(yield* pageTraces(query), input.limit)
				return {
					nextCursor: Option.map(page.last, Struct.pick(['duration', 'id', 'start'])),
					total: (yield* countTraces(query)).count,
					traces: Array.map(page.items, traceRow)
				} satisfies TracesAnswer
			}, asTelemetryError),
			ingestLogs: Effect.fn('Telemetry.ingestLogs')(
				function* (payload: LogsRequest) {
					const receivedAt = yield* DateTime.now
					const logs = yield* pipe(
						Option.getOrElse(payload.resourceLogs, () => []),
						Array.flatMap(group => {
							const sender = senderOf(group.resource)
							return pipe(
								group.scopeLogs,
								Option.getOrElse(() => []),
								Array.flatMap(scope =>
									pipe(
										scope.logRecords,
										Option.getOrElse(() => []),
										Array.map(log => ({group, log, sender}))
									)
								)
							)
						}),
						Effect.forEach(
							Effect.fnUntraced(function* (item) {
								// A log record has no id of its own, so the identity is what it carries.
								const log = yield* Schema.encodeEffect(ExportedLog)(item.log)
								const resource = yield* Effect.transposeOption(
									Option.map(item.group.resource, Schema.encodeEffect(Resource))
								)
								const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
									attributes: log.attributes ?? [],
									body: log.body ?? {},
									observedTimeUnixNano: log.observedTimeUnixNano ?? '',
									resource: Option.getOrElse(resource, () => ({})),
									severityNumber: log.severityNumber,
									severityText: log.severityText ?? '',
									spanId: log.spanId ?? '',
									timeUnixNano: log.timeUnixNano,
									traceId: log.traceId ?? ''
								})
								return logOf(
									item.sender,
									item.log,
									LogId.make(yield* digest.digestHex(Digest.sha256, utf8.encode(encoded))),
									receivedAt
								)
							}),
							{concurrency: 1}
						)
					)
					yield* chunked(logs, saveLogs)
					yield* supersede(logs)
				},
				Reactivity.mutation(['telemetry']),
				sql.withTransaction,
				asTelemetryError,
				withReactivity
			),
			// One commit per export, and the pages read again only after it.
			ingestTraces: Effect.fn('Telemetry.ingestTraces')(
				function* (payload: TracesRequest) {
					const receivedAt = yield* DateTime.now
					const incoming = spansOf(payload)
					yield* chunked(
						touchedTraces(incoming.spans, yield* listSpans(traceIdsOf(incoming.spans)), receivedAt),
						saveTraces
					)
					yield* chunked(incoming.spans, saveSpans)
					yield* chunked(incoming.links, saveLinks)
					yield* supersede(incoming.spans)
				},
				Reactivity.mutation(['telemetry']),
				sql.withTransaction,
				asTelemetryError,
				withReactivity
			),
			listOperations: Effect.fn('Telemetry.listOperations')(function* (input: ListOperationsParams) {
				return operationsAnswer(yield* readOverview(input.since), input.app)
			}, asTelemetryError),
			measureLatency: Effect.fn('Telemetry.measureLatency')(function* (input: MeasureLatencyParams) {
				const rows = yield* listLatencies({
					cutoff: rangeStart(input.since, yield* DateTime.now),
					name: input.name,
					services: yield* servicesOf(input.app)
				})
				const latency = latencyOf(Array.map(rows, row => Option.getOrElse(row.duration, () => Duration.zero)))
				return {
					count: rows.length,
					failures: Array.countBy(rows, row => row.status === 'failed'),
					maxMs: Duration.millis(Number.round(Duration.toMillis(latency.maxMs), 1)),
					p50Ms: Duration.millis(Number.round(Duration.toMillis(latency.p50Ms), 1)),
					p95Ms: Duration.millis(Number.round(Duration.toMillis(latency.p95Ms), 1))
				} satisfies LatencyAnswer
			}, asTelemetryError),
			readTrace: Effect.fn('Telemetry.readTrace')(function* (
				input: ReadTraceParams,
				offset: number = 0,
				spanId: Option.Option<SpanId> = Option.none(),
				details: boolean = false
			) {
				return readTraceAnswer(yield* tree(input.id), input.limit, offset, details, spanId)
			}, asTelemetryError),
			reject: Effect.fn('Telemetry.reject')(function* (input: Pick<Rejection, 'credential' | 'route' | 'status'>) {
				const now = yield* DateTime.now
				const key = `${input.route}:${input.status}:${input.credential}`
				yield* Ref.update(rejections, current =>
					Record.set(current, key, {...input, count: (current[key]?.count ?? 0) + 1, lastAt: now})
				)
			}),
			searchLogs: Effect.fn('Telemetry.searchLogs')(function* (input: SearchLogsParams) {
				const query = {
					cursor: input.cursor,
					cutoff: rangeStart(input.since, yield* DateTime.now),
					limit: input.limit,
					minimum: Option.map(input.level, level => LEVELS[level]),
					services: yield* servicesOf(input.app),
					text: Option.map(input.text, String.toLowerCase),
					traceId: Option.map(input.trace, id => TraceId.make(String.toLowerCase(id)))
				} satisfies LogQuery
				const page = pageOf(yield* pageLogs(query), input.limit)
				return {
					logs: Array.map(page.items, log => {
						const attrs = attributesFlat(log.attributes, '', false)
						const side = sideOf(log.service, log.runtime)
						return {
							app: appName(log.service),
							at: log.time,
							attrs,
							level: levelOf(log.severity),
							message: log.message,
							side,
							span: log.spanId,
							trace: log.traceId
						}
					}),
					nextCursor: Option.map(page.last, Struct.pick(['id', 'time'])),
					total: (yield* countLogs(query)).count
				} satisfies LogsAnswer
			}, asTelemetryError),
			// A trace and every trace a span link joins to it, as one tree.
			trace: Effect.fn('Telemetry.trace')(tree, asTelemetryError),
			// What the page watches: read again after each committed write, at most once a second, always the newest.
			watch: (range: Range) =>
				pipe(
					sql.reactive(['telemetry'], readOverview(range)),
					Stream.mapError(cause => TelemetryError.make({cause, message: UNAVAILABLE})),
					Stream.buffer({capacity: 1, strategy: 'sliding'}),
					Stream.flatMap(overview =>
						Stream.concat(Stream.succeed(overview), Stream.drain(Stream.fromEffect(Effect.sleep(Duration.seconds(1)))))
					),
					Stream.withSpan('Telemetry.watch', {attributes: {range, 'rpc.stream': true}})
				),
			watchTrace: (id: TraceId) =>
				pipe(
					sql.reactive(['telemetry'], tree(id)),
					Stream.changesWith(Schema.toEquivalence(TraceTree)),
					Stream.mapError(cause => TelemetryError.make({cause, message: UNAVAILABLE})),
					Stream.withSpan('Telemetry.watchTrace', {attributes: {id, 'rpc.stream': true}})
				)
		}
	})
}) {
	// The tables this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({
			loader: Migrator.fromRecord({
				'0001_telemetry': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`
						CREATE TABLE traces (
							id TEXT PRIMARY KEY,
							root TEXT NOT NULL,
							start REAL NOT NULL,
							duration REAL NOT NULL,
							broken TEXT,
							rooted INTEGER NOT NULL,
							waits INTEGER NOT NULL,
							receivedAt INTEGER NOT NULL
						) STRICT
					`
					yield* sql`CREATE INDEX traces_by_start ON traces (start)`
					yield* sql`CREATE INDEX traces_by_received ON traces (receivedAt)`
					// Keyed by trace first, so a trace reads as one range of the table.
					yield* sql`
						CREATE TABLE spans (
							traceId TEXT NOT NULL REFERENCES traces (id) ON DELETE CASCADE,
							spanId TEXT NOT NULL,
							parentSpanId TEXT,
							name TEXT NOT NULL,
							service TEXT NOT NULL,
							runtime TEXT NOT NULL,
							run INTEGER,
							version TEXT,
							start REAL NOT NULL,
							duration REAL,
							status TEXT NOT NULL,
							error TEXT,
							exception TEXT,
							attributes TEXT NOT NULL,
							PRIMARY KEY (traceId, spanId)
						) STRICT, WITHOUT ROWID
					`
					yield* sql`CREATE INDEX spans_by_name ON spans (name, start)`
					yield* sql`CREATE INDEX spans_by_release ON spans (service, version)`
					yield* sql`
						CREATE TABLE span_links (
							traceId TEXT NOT NULL,
							spanId TEXT NOT NULL,
							linkedTraceId TEXT NOT NULL,
							linkedSpanId TEXT NOT NULL,
							PRIMARY KEY (traceId, spanId, linkedTraceId, linkedSpanId),
							FOREIGN KEY (traceId, spanId) REFERENCES spans (traceId, spanId) ON DELETE CASCADE
						) STRICT, WITHOUT ROWID
					`
					yield* sql`CREATE INDEX span_links_by_linked ON span_links (linkedTraceId)`
					yield* sql`
						CREATE TABLE logs (
							id TEXT PRIMARY KEY,
							traceId TEXT,
							spanId TEXT,
							service TEXT NOT NULL,
							runtime TEXT NOT NULL,
							run INTEGER,
							version TEXT,
							time REAL NOT NULL,
							severity INTEGER NOT NULL,
							message TEXT NOT NULL,
							attributes TEXT NOT NULL,
							receivedAt INTEGER NOT NULL
						) STRICT
					`
					yield* sql`CREATE INDEX logs_by_time ON logs (time)`
					yield* sql`CREATE INDEX logs_by_trace ON logs (traceId)`
					yield* sql`CREATE INDEX logs_by_release ON logs (service, version)`
					yield* sql`CREATE INDEX logs_by_received ON logs (receivedAt)`
					yield* sql`CREATE TABLE releases (service TEXT PRIMARY KEY, version TEXT NOT NULL) STRICT`
				})
			}),
			table: 'telemetry_migrations'
		})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}
