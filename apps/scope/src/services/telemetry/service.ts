import {
	Array,
	Boolean,
	Cache,
	Context,
	DateTime,
	Duration,
	Effect,
	Function,
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
	Scope,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {Digest} from 'effect/crypto'
import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {TimeFrame} from '@deslop/runtime/shared/time'

import {
	appName,
	attributesFlat,
	diagnosis,
	latencyOf,
	levelOf,
	logOf,
	overviewOf,
	sideOf,
	senderOf,
	spansOf,
	touchedTraces,
	traceIdsOf,
	traceTree
} from '#services/telemetry/lib/utils.ts'
import type {
	CompactLog,
	LogFacts,
	RejectedExport,
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
	ReadTraceAnswer,
	ReadTraceParams,
	Rejection,
	SearchLogsParams,
	TraceRow,
	TracesAnswer,
	TracesRequest,
	AppName,
	ServiceName,
	SpanId
} from '#services/telemetry/schema.ts'
import {
	FoundTrace,
	CountedOperation,
	ExportedLog,
	LatencyQuery,
	Log,
	LogId,
	LogQuery,
	McpServerName,
	McpToolName,
	rangeStart,
	Resource,
	RetainedService,
	ServiceRun,
	SettledTrace,
	Span,
	SpanLink,
	StoredLog,
	StoredResource,
	StoredSpan,
	StoredSpanLink,
	StoredStatement,
	StoredTrace,
	TelemetryError,
	Trace,
	TraceDetail,
	TraceId,
	TraceIds,
	TraceQuery,
	TraceTree
} from '#services/telemetry/schema.ts'

const MISSING =
	'No kept telemetry has this trace id: check the id, check ingestion with check_ingestion, or reproduce it if it is older than thirty days.'

const UNAVAILABLE = 'The telemetry storage could not be read or written.'

const LEVELS = {debug: 5, error: 17, info: 9, warn: 13}

const asTelemetryError = Effect.mapError((cause: unknown) => TelemetryError.make({cause, message: UNAVAILABLE}))

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly telemetry: never
	}
}

// One phrase whose last word may be a prefix, so a word still being typed matches.
function phrase(text: string) {
	return `"${String.replaceAll('"', '""')(text)}"*`
}

// The overview's kept traces with their labels and failures; a trace pruned since the overview counted it stays without them until the next read.
function detailed(overview: Overview, rows: readonly TraceDetail[]) {
	const byId = Record.fromIterableBy(rows, row => row.id)
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
		Array.filter(app => Option.match(name, {onNone: Function.constTrue, onSome: value => app.name === value})),
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

function compactLog(log: LogFacts) {
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

// The minimum span start, or the first tree log's timestamp when no spans arrived.
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
	const byId = Record.fromIterableBy(tree.spans, span => span.spanId)
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

		const statusOf = sql`CASE spans.status WHEN 1 THEN 'failed' WHEN 2 THEN 'denied' ELSE 'ok' END`
		// Ids are blobs in SQL and hex outside; `nullif` turns `hex(NULL)`'s '' back into an absence.
		const spanColumns = sql`
			lower(hex(traces.traceId)) AS traceId, lower(hex(spans.span)) AS spanId,
			nullif(lower(hex(spans.parent)), '') AS parentSpanId,
			resources.service, resources.runtime, resources.run, resources.version,
			spans.name, spans.start, spans.duration, ${statusOf} AS status, spans.error, spans.exception,
			json_patch(spans.attributes, json_object('db.query.text', statements.text)) AS attributes
		`
		const spanFrom = sql`
			FROM spans
			JOIN traces ON traces.id = spans.trace
			JOIN resources ON resources.id = spans.resource
			LEFT JOIN statements ON statements.id = spans.statement
		`
		const logColumns = sql`
			logs.id, nullif(lower(hex(traces.traceId)), '') AS traceId, nullif(lower(hex(logs.span)), '') AS spanId,
			resources.service, resources.runtime, resources.run, resources.version,
			logs.time, logs.severity, logs.message, logs.attributes, traces.receivedAt
		`
		const logFrom = sql`FROM logs JOIN traces ON traces.id = logs.trace JOIN resources ON resources.id = logs.resource`
		// The trace beside its root's sender, and the span where it broke.
		const traceFrom = sql`FROM traces JOIN resources AS root ON root.id = traces.resource`
		const traceJoins = sql`${traceFrom} LEFT JOIN spans AS broken ON broken.trace = traces.id AND broken.span = traces.broken`
		// Keep unrouted HTTP traces searchable, but scanners are not application operations.
		const operationTrace = sql`NOT traces.waits AND traces.name NOT LIKE '% (no route)'`
		// The trace ids of a JSON array, as a subquery `IN` reads.
		function traceIds(ids: string) {
			return sql`(SELECT unhex(value) FROM json_each(${ids}))`
		}

		// The traces a query selects; its text matches a span's name, attributes or error, or one of its logs, never its ids or times.
		function filterTraces(query: typeof TraceQuery.Encoded) {
			return sql.and([
				sql`NOT traces.waits`,
				sql`traces.start >= ${query.cutoff}`,
				...Array.getSomes([
					Option.map(Option.fromNullOr(query.services), services => sql`root.service IN ${sql.in(services)}`),
					Option.map(Option.fromNullOr(query.operation), name => sql`traces.name = ${name}`),
					Option.map(
						Option.fromNullOr(query.span),
						name => sql`EXISTS (SELECT 1 FROM spans AS named WHERE named.trace = traces.id AND named.name = ${name})`
					),
					Option.map(
						Option.fromNullOr(query.text),
						text => sql`traces.id IN (
							SELECT spans.trace FROM span_search JOIN spans ON spans.id = span_search.rowid
							WHERE span_search MATCH ${phrase(text)}
							UNION
							SELECT logs.trace FROM log_search JOIN logs ON logs.id = log_search.rowid
							WHERE log_search MATCH ${phrase(text)}
						)`
					),
					Option.liftPredicate(sql`traces.broken IS NOT NULL`, () => query.errors)
				])
			])
		}
		function filterLogs(query: typeof LogQuery.Encoded) {
			return sql.and([
				sql`logs.time >= ${query.cutoff}`,
				...Array.getSomes([
					Option.map(Option.fromNullOr(query.services), services => sql`resources.service IN ${sql.in(services)}`),
					Option.map(Option.fromNullOr(query.traceId), traceId => sql`traces.traceId = unhex(${traceId})`),
					Option.map(
						Option.fromNullOr(query.text),
						text => sql`logs.id IN (SELECT rowid FROM log_search WHERE log_search MATCH ${phrase(text)})`
					),
					Option.map(Option.fromNullOr(query.minimum), minimum => sql`logs.severity >= ${minimum}`)
				])
			])
		}

		const listSpans = SqlSchema.findAll({
			Request: TraceIds,
			Result: Span,
			execute: ids => sql`SELECT ${spanColumns} ${spanFrom} WHERE traces.traceId IN ${traceIds(ids)}`
		})
		const listLogs = SqlSchema.findAll({
			Request: TraceIds,
			Result: Log,
			execute: ids => sql`SELECT ${logColumns} ${logFrom} WHERE traces.traceId IN ${traceIds(ids)}`
		})
		const listLinks = SqlSchema.findAll({
			Request: TraceIds,
			Result: SpanLink,
			execute: ids => sql`
				SELECT
					lower(hex(traces.traceId)) AS traceId, lower(hex(span_links.span)) AS spanId,
					lower(hex(span_links.linkedTrace)) AS linkedTraceId, lower(hex(span_links.linkedSpan)) AS linkedSpanId
				FROM span_links JOIN traces ON traces.id = span_links.trace
				WHERE traces.traceId IN ${traceIds(ids)}
			`
		})
		// The trace and every trace a span link joins to it, either way.
		const listLinkedTraces = SqlSchema.findAll({
			Request: TraceId,
			Result: Schema.Struct({id: TraceId}),
			execute: id => sql`
				WITH RECURSIVE linked (id) AS (
					SELECT unhex(${id})
					UNION
					SELECT span_links.linkedTrace FROM span_links
					JOIN traces ON traces.id = span_links.trace JOIN linked ON traces.traceId = linked.id
					UNION
					SELECT traces.traceId FROM span_links
					JOIN traces ON traces.id = span_links.trace JOIN linked ON span_links.linkedTrace = linked.id
				)
				SELECT lower(hex(id)) AS id FROM linked
			`
		})

		// Insert distinct sender tuples at this JSON path, ignoring conflicts with stored resources.
		function saveResources(batch: string, path: string) {
			return sql`
				INSERT INTO ${sql(StoredResource.table)} (service, runtime, run, version)
				SELECT DISTINCT value ->> 'service', value ->> 'runtime', value ->> 'run', value ->> 'version'
				FROM json_each(${batch}, ${path})
				WHERE true
				ON CONFLICT DO NOTHING
			`
		}
		// The stored sender an arriving row names; an absent run or release matches only another absence.
		const arrivingSender = sql`
			resources.service = arriving.value ->> 'service' AND resources.runtime = arriving.value ->> 'runtime'
			AND resources.run IS arriving.value ->> 'run' AND resources.version IS arriving.value ->> 'version'
		`
		const arrivingAttributes = sql`(arriving.value ->> 'attributes')`
		// An export's spans, the traces they touch and their links: one statement per table for the whole export, so search indexes only the spans that changed.
		const saveExport = SqlSchema.void({
			Request: Schema.fromJsonString(
				Schema.Struct({links: Schema.Array(SpanLink), spans: Schema.Array(Span), traces: Schema.Array(Trace)})
			),
			execute: batch =>
				Effect.gen(function* () {
					yield* saveResources(batch, '$.spans')
					yield* sql`
						INSERT INTO ${sql(StoredStatement.table)} (text)
						SELECT DISTINCT ${arrivingAttributes} ->> '$."db.query.text"' FROM json_each(${batch}, '$.spans') AS arriving
						WHERE json_type(${arrivingAttributes}, '$."db.query.text"') = 'text'
						ON CONFLICT DO NOTHING
					`
					// A trace keeps the time its first span or log arrived.
					yield* sql`
						INSERT INTO traces (traceId, resource, name, label, start, duration, spans, broken, rooted, waits, receivedAt)
						SELECT
							unhex(arriving.value ->> 'id'), resources.id, arriving.value ->> 'name', arriving.value ->> 'label',
							arriving.value ->> 'start', arriving.value ->> 'duration', arriving.value ->> 'spans',
							unhex(arriving.value ->> 'broken'), arriving.value ->> 'rooted', arriving.value ->> 'waits',
							arriving.value ->> 'receivedAt'
						FROM json_each(${batch}, '$.traces') AS arriving JOIN resources ON ${arrivingSender}
						WHERE true
						ON CONFLICT (traceId) DO UPDATE SET
							resource = excluded.resource, name = excluded.name, label = excluded.label, start = excluded.start,
							duration = excluded.duration, spans = excluded.spans, broken = excluded.broken,
							rooted = excluded.rooted, waits = excluded.waits
					`
					// A retried export or a finished run sends a span again; the newer copy replaces the stored one. Constant keys go, and the statement is stored once.
					yield* sql`
						INSERT INTO spans (trace, span, parent, resource, name, kind, start, duration, status, error, exception, statement, attributes)
						SELECT
							traces.id, unhex(arriving.value ->> 'spanId'), unhex(arriving.value ->> 'parentSpanId'), resources.id,
							arriving.value ->> 'name',
							CASE
								WHEN ${arrivingAttributes} ->> '$."rpc.stream"' = 1 THEN 1
								WHEN ${arrivingAttributes} ->> '$."machine.invoke.kind"' = 'Timer' THEN 2
								WHEN arriving.value ->> 'name' = (${arrivingAttributes} ->> '$."http.request.method"') || ' (no route)' THEN 3
								ELSE 0
							END,
							arriving.value ->> 'start', arriving.value ->> 'duration',
							CASE arriving.value ->> 'status' WHEN 'failed' THEN 1 WHEN 'denied' THEN 2 ELSE 0 END,
							arriving.value ->> 'error', arriving.value ->> 'exception', statements.id,
							json_remove(
								${arrivingAttributes}, '$."db.query.text"', '$."db.system.name"', '$."effect.sql.method"',
								'$."rpc.system.name"', '$."url.scheme"', '$."server.address"', '$."server.port"', '$."url.path"'
							)
						FROM json_each(${batch}, '$.spans') AS arriving
						JOIN traces ON traces.traceId = unhex(arriving.value ->> 'traceId')
						JOIN resources ON ${arrivingSender}
						LEFT JOIN statements ON statements.text = ${arrivingAttributes} ->> '$."db.query.text"'
						WHERE true
						ON CONFLICT (trace, span) DO UPDATE SET
							parent = excluded.parent, resource = excluded.resource, name = excluded.name, kind = excluded.kind,
							start = excluded.start, duration = excluded.duration, status = excluded.status, error = excluded.error,
							exception = excluded.exception, statement = excluded.statement, attributes = excluded.attributes
					`
					// A waiting trace's root is a stream too: an RPC span inherits its subscription child's wait.
					yield* sql`
						UPDATE spans SET kind = 1
						FROM json_each(${batch}, '$.traces') AS arriving
						JOIN traces ON traces.traceId = unhex(arriving.value ->> 'id')
						WHERE arriving.value ->> 'waits' AND spans.kind = 0
						AND spans.trace = traces.id AND spans.span = unhex(arriving.value ->> 'root')
					`
					yield* sql`
						INSERT INTO span_links (trace, span, linkedTrace, linkedSpan)
						SELECT
							traces.id, unhex(arriving.value ->> 'spanId'), unhex(arriving.value ->> 'linkedTraceId'),
							unhex(arriving.value ->> 'linkedSpanId')
						FROM json_each(${batch}, '$.links') AS arriving
						JOIN traces ON traces.traceId = unhex(arriving.value ->> 'traceId')
						WHERE true
						ON CONFLICT DO NOTHING
					`
				})
		})
		const saveLogs = SqlSchema.void({
			Request: Schema.fromJsonString(Schema.Array(Log)),
			execute: batch =>
				Effect.gen(function* () {
					yield* saveResources(batch, '$')
					// A log starts the trace it names when no span of it has arrived; the logs that name none share one trace for their export.
					yield* sql`
						INSERT INTO traces (traceId, resource, name, start, duration, spans, rooted, waits, receivedAt)
						SELECT
							unhex(arriving.value ->> 'traceId'), min(resources.id), '', min(arriving.value ->> 'time'), 0, 0, 0, 1,
							min(arriving.value ->> 'receivedAt')
						FROM json_each(${batch}) AS arriving JOIN resources ON ${arrivingSender}
						WHERE true
						GROUP BY arriving.value ->> 'traceId'
						ON CONFLICT (traceId) DO NOTHING
					`
					// A retried export carries the same records, whose digests are already stored. The export's own trace is the newest without an id.
					yield* sql`
						INSERT INTO logs (id, trace, span, resource, time, severity, message, attributes)
						SELECT
							arriving.value ->> 'id',
							coalesce(
								(SELECT id FROM traces WHERE traceId = unhex(arriving.value ->> 'traceId')),
								(SELECT max(id) FROM traces WHERE traceId IS NULL)
							),
							unhex(arriving.value ->> 'spanId'), resources.id, arriving.value ->> 'time',
							arriving.value ->> 'severity', arriving.value ->> 'message', arriving.value ->> 'attributes'
						FROM json_each(${batch}) AS arriving JOIN resources ON ${arrivingSender}
						WHERE true
						ON CONFLICT DO NOTHING
					`
				})
		})
		// Trace ids rise in arrival order, so retention drops every trace up to the newest one received before the cutoff, with its spans, logs, links and search entries.
		const deleteExpired = SqlSchema.void({
			Request: Trace.fields.receivedAt,
			execute: cutoff => {
				const last = sql`(SELECT max(id) FROM traces WHERE receivedAt < ${cutoff})`
				return Effect.all(
					[
						sql`DELETE FROM ${sql(StoredSpanLink.table)} WHERE trace <= ${last}`,
						sql`DELETE FROM ${sql(StoredLog.table)} WHERE trace <= ${last}`,
						sql`DELETE FROM ${sql(StoredSpan.table)} WHERE trace <= ${last}`,
						sql`DELETE FROM ${sql(StoredTrace.table)} WHERE id <= ${last}`,
						sql`DELETE FROM ${sql(StoredResource.table)} WHERE id NOT IN (SELECT resource FROM traces UNION SELECT resource FROM spans UNION SELECT resource FROM logs)`,
						sql`DELETE FROM ${sql(StoredStatement.table)} WHERE id NOT IN (SELECT statement FROM spans WHERE statement IS NOT NULL)`
					],
					{concurrency: 1, discard: true}
				)
			}
		})
		// Match appName in SQL so services with the same app and runtime share percentiles and kept traces.
		const serviceName = sql`CASE WHEN substr(root.service, 1, 8) = '@deslop/' THEN substr(root.service, 9) ELSE root.service END`
		const appColumn = sql`CASE
			WHEN substr(${serviceName}, -7) IN ('-server', '-client') THEN substr(${serviceName}, 1, length(${serviceName}) - 7)
			WHEN substr(${serviceName}, -4) = '-ios' THEN substr(${serviceName}, 1, length(${serviceName}) - 4)
			ELSE ${serviceName} END`
		const OverviewRange = Schema.Struct({cutoff: Span.fields.start, settledBefore: Span.fields.start})
		const listOperationCounts = SqlSchema.findAll({
			Request: OverviewRange,
			Result: CountedOperation,
			execute: query => sql`
				SELECT
					${appColumn} AS app, root.runtime, traces.name, count(*) AS count,
					sum(traces.broken IS NOT NULL) AS failures, max(traces.start) AS latest,
					json_extract(json_group_array(traces.duration ORDER BY traces.duration),
						'$[' || ((count(*) + 1) / 2 - 1) || ']') AS p50Ms,
					json_extract(json_group_array(traces.duration ORDER BY traces.duration),
						'$[' || ((count(*) * 95 + 99) / 100 - 1) || ']') AS p95Ms
				${traceFrom}
				WHERE ${operationTrace} AND traces.start >= ${query.cutoff}
				AND (traces.rooted OR traces.start < ${query.settledBefore})
				GROUP BY app, root.runtime, traces.name
				ORDER BY min(traces.start), min(traces.id)
			`
		})
		const listKeptTraces = SqlSchema.findAll({
			Request: Schema.Struct({
				...OverviewRange.fields,
				...Struct.pick(CountedOperation.fields, ['app', 'runtime', 'name'])
			}),
			Result: SettledTrace,
			execute: query => {
				const columns = sql`lower(hex(traces.traceId)) AS id, traces.id AS arrival, traces.start, traces.duration,
					root.service, root.runtime, traces.name, traces.broken IS NOT NULL AS failed`
				const where = sql`${operationTrace} AND traces.name = ${query.name}
					AND ${appColumn} = ${query.app} AND root.runtime = ${query.runtime}
					AND traces.start >= ${query.cutoff} AND (traces.rooted OR traces.start < ${query.settledBefore})`
				return sql`
					WITH failures AS (
						SELECT ${columns} ${traceFrom} WHERE ${where} AND traces.broken IS NOT NULL
						ORDER BY traces.start DESC, traces.duration DESC, traces.id LIMIT 10
					), slowest AS (
						SELECT ${columns} ${traceFrom} WHERE ${where}
						ORDER BY traces.duration DESC, traces.start, traces.id LIMIT 20
					), candidates AS (
						SELECT * FROM failures UNION SELECT * FROM slowest
					), kept AS (
						SELECT * FROM candidates
						ORDER BY id IN (SELECT id FROM failures) DESC, duration DESC, start, arrival LIMIT 20
					)
					SELECT * FROM kept ORDER BY duration DESC, id IN (SELECT id FROM failures) DESC, start, arrival
				`
			}
		})
		const listRetainedServices = SqlSchema.findAll({
			Request: Span.fields.start,
			Result: RetainedService,
			execute: settledBefore => sql`
				SELECT root.service, min(root.runtime = 'ci') AS ci, count(*) AS count, sum(traces.broken IS NOT NULL) AS failures
				${traceFrom}
				WHERE ${operationTrace} AND (traces.rooted OR traces.start < ${settledBefore})
				GROUP BY root.service
			`
		})
		// The label and failure of the traces the overview keeps, read for them alone.
		const listDetails = SqlSchema.findAll({
			Request: TraceIds,
			Result: TraceDetail,
			execute: ids => sql`
				SELECT lower(hex(traces.traceId)) AS id, traces.label, broken.name AS broken, broken.error, broken.exception
				${traceJoins}
				WHERE traces.traceId IN ${traceIds(ids)}
			`
		})
		const listServices = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Schema.Struct(Struct.pick(Span.fields, ['service'])),
			execute: () => sql`
				SELECT DISTINCT service FROM resources
				WHERE EXISTS (SELECT 1 FROM spans WHERE resource = resources.id)
				OR EXISTS (SELECT 1 FROM logs WHERE resource = resources.id)
			`
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
							onFalse: () => sql`(traces.start < ${cursor.start}
								OR (traces.start = ${cursor.start} AND traces.traceId < unhex(${cursor.id})))`,
							onTrue: () => sql`(traces.duration < ${cursor.duration}
								OR (traces.duration = ${cursor.duration} AND traces.traceId < unhex(${cursor.id})))`
						})
				})
				return sql`
					SELECT
						lower(hex(traces.traceId)) AS id, traces.start, traces.duration, root.service, root.runtime, traces.name,
						broken.name AS broken, broken.error, broken.exception, traces.spans,
						(
							SELECT relay.attributes FROM spans AS relay
							WHERE relay.trace = traces.id AND relay.name = 'Gateway.call' LIMIT 1
						) AS relay
					${traceJoins}
					WHERE ${filterTraces(query)} AND ${after}
					ORDER BY ${Boolean.match(query.slowest, {onFalse: () => sql`traces.start DESC`, onTrue: () => sql`traces.duration DESC`})}, traces.traceId DESC
					LIMIT ${query.limit + 1}
				`
			}
		})
		const countTraces = SqlSchema.findOne({
			Request: TraceQuery,
			Result: Schema.Struct({count: Schema.Int}),
			execute: query => sql`SELECT count(*) AS count ${traceFrom} WHERE ${filterTraces(query)}`
		})
		const pageLogs = SqlSchema.findAll({
			Request: LogQuery,
			Result: Log,
			execute: query => {
				const after = Option.match(Option.fromNullOr(query.cursor), {
					onNone: () => sql`1=1`,
					onSome: cursor => sql`(logs.time < ${cursor.time} OR (logs.time = ${cursor.time} AND logs.id > ${cursor.id}))`
				})
				return sql`
					SELECT ${logColumns} ${logFrom}
					WHERE ${filterLogs(query)} AND ${after}
					ORDER BY logs.time DESC, logs.id
					LIMIT ${query.limit + 1}
				`
			}
		})
		const countLogs = SqlSchema.findOne({
			Request: LogQuery,
			Result: Schema.Struct({count: Schema.Int}),
			execute: query => sql`SELECT count(*) AS count ${logFrom} WHERE ${filterLogs(query)}`
		})
		// The spans of one name that measure work: a stream, a machine's timer and an unrouted request are kinds of their own.
		const listLatencies = SqlSchema.findAll({
			Request: LatencyQuery,
			Result: Schema.Struct(Struct.pick(Span.fields, ['duration', 'status'])),
			execute: query => sql`
				SELECT spans.duration, ${statusOf} AS status
				FROM spans JOIN resources ON resources.id = spans.resource
				WHERE spans.kind = 0 AND spans.name = ${query.name} AND spans.start >= ${query.cutoff}
				AND ${Option.match(Option.fromNullOr(query.services), {
					onNone: () => sql`1=1`,
					onSome: services => sql`resources.service IN ${sql.in(services)}`
				})}
			`
		})
		// Each service's latest run: what its senders of that run sent, and when they last did.
		const listRuns = SqlSchema.findAll({
			Request: Schema.Void,
			Result: ServiceRun,
			execute: () => sql`
				WITH
					senders AS (
						SELECT
							resources.service, resources.runtime, resources.run, resources.version,
							(SELECT count(*) FROM spans WHERE resource = resources.id)
								+ (SELECT count(*) FROM logs WHERE resource = resources.id) AS entries,
							max(
								coalesce((SELECT max(start) FROM spans WHERE resource = resources.id), 0),
								coalesce((SELECT max(time) FROM logs WHERE resource = resources.id), 0)
							) AS lastEvent
						FROM resources
					),
					sending AS (SELECT * FROM senders WHERE entries > 0),
					latest AS (SELECT service, max(coalesce(run, 0)) AS run FROM sending GROUP BY service)
				SELECT
					sending.service, sum(sending.entries) AS entries, max(sending.lastEvent) AS lastEvent,
					max(sending.run) AS run, max(sending.runtime) AS runtime, max(sending.version) AS version
				FROM sending JOIN latest ON latest.service = sending.service AND coalesce(sending.run, 0) = latest.run
				GROUP BY sending.service
				ORDER BY sending.service
			`
		})

		// Some of the retained service names matching an app, or None to leave the caller's service filter unrestricted.
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
		// Thirty days of telemetry cover the longest time frame without keeping older runs in every query.
		const prune = pipe(
			DateTime.now,
			Effect.flatMap(now => deleteExpired(DateTime.subtractDuration(now, Duration.days(30)))),
			Reactivity.mutation(['telemetry']),
			sql.withTransaction,
			asTelemetryError,
			withReactivity,
			Effect.withSpan('Telemetry.prune')
		)
		// The overview counts operations in the selected range and app tabs over all retained settled traces.
		const readOverview = Effect.fnUntraced(function* (range: TimeFrame) {
			const now = yield* DateTime.now
			const settledBefore = DateTime.subtractDuration(now, Duration.minutes(1))
			const query = {cutoff: rangeStart(range, now), settledBefore}
			const counted = overviewOf(
				yield* Effect.forEach(
					yield* listOperationCounts(query),
					Effect.fnUntraced(function* (operation) {
						const traces = yield* listKeptTraces({...query, ...operation})
						if (!Array.isReadonlyArrayNonEmpty(traces)) return yield* TelemetryError.make({message: UNAVAILABLE})
						return {
							...operation,
							traces: Array.map(traces, row => ({
								duration: row.duration,
								failure: Option.none(),
								id: row.id,
								label: Option.none(),
								start: row.start
							}))
						}
					}),
					{concurrency: 1}
				),
				yield* listRetainedServices(settledBefore)
			)
			return detailed(
				counted,
				yield* listDetails(
					Array.flatMap(counted.apps, app =>
						Array.flatMap(app.operations, operation => Array.map(operation.traces, trace => trace.id))
					)
				)
			)
		}, sql.withTransaction)
		// Cache lookups may run in an RPC's scope; shared sources belong to this service instead.
		const serviceScope = yield* Effect.scope
		const overviews = yield* Cache.make({
			capacity: TimeFrame.literals.length,
			lookup: Effect.fnUntraced(function* (range: TimeFrame) {
				return yield* pipe(
					// Buffer cheap invalidations, not computed overviews. A pending write survives the cooldown.
					sql.reactive(['telemetry'], Effect.void),
					Stream.buffer({capacity: 1, strategy: 'sliding'}),
					Stream.flatMap(() =>
						Stream.concat(
							Stream.fromEffect(readOverview(range)),
							Stream.fromEffectDrain(Effect.sleep(Duration.seconds(1)))
						)
					),
					Stream.mapError(cause => TelemetryError.make({cause, message: UNAVAILABLE})),
					Stream.withSpan('Telemetry.watch', {attributes: {range, 'rpc.stream': true}}),
					Stream.share({capacity: 1, replay: 1, strategy: 'sliding'}),
					Effect.provideService(Scope.Scope, serviceScope)
				)
			})
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
						payload.resourceLogs,
						Option.getOrElse(Array.empty<Option.Option.Value<LogsRequest['resourceLogs']>[number]>),
						Effect.forEach(
							Effect.fnUntraced(function* (group) {
								const sender = senderOf(group.resource)
								const resource = yield* Effect.transposeOption(
									Option.map(group.resource, Schema.encodeEffect(Resource))
								)
								return pipe(
									group.scopeLogs,
									Option.getOrElse(() => []),
									Array.flatMap(scope =>
										pipe(
											scope.logRecords,
											Option.getOrElse(() => []),
											Array.map(log => ({log, resource, sender}))
										)
									)
								)
							}),
							{concurrency: 1}
						),
						Effect.map(Array.flatten),
						Effect.flatMap(items =>
							Effect.forEach(
								items,
								Effect.fnUntraced(function* (item) {
									// A log record has no id of its own, so the identity is what it carries.
									const log = yield* Schema.encodeEffect(ExportedLog)(item.log)
									const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
										attributes: log.attributes ?? [],
										body: log.body ?? {},
										observedTimeUnixNano: log.observedTimeUnixNano ?? '',
										resource: Option.getOrElse(item.resource, () => ({})),
										severityNumber: log.severityNumber,
										severityText: log.severityText ?? '',
										spanId: log.spanId ?? '',
										timeUnixNano: log.timeUnixNano,
										traceId: log.traceId ?? ''
									})
									// The digest's first six bytes, read as one integer.
									const id = LogId.make(
										Array.reduce(
											(yield* digest.digest(Digest.sha256, utf8.encode(encoded))).subarray(0, 6),
											0,
											(value, byte) => value * 256 + byte
										)
									)
									return logOf(item.sender, item.log, id, receivedAt)
								}),
								{concurrency: 1}
							)
						)
					)
					yield* sql.withTransaction(saveLogs(logs))
				},
				Reactivity.mutation(['telemetry']),
				asTelemetryError,
				withReactivity
			),
			// One commit per export, and the pages read again only after it.
			ingestTraces: Effect.fn('Telemetry.ingestTraces')(
				function* (payload: TracesRequest) {
					const receivedAt = yield* DateTime.now
					const incoming = spansOf(payload)
					const stored = yield* listSpans(traceIdsOf(incoming.spans))
					// A late CI start cannot replace a completed span; read and write share this transaction.
					const completed = HashSet.fromIterable(
						pipe(
							stored,
							Array.filter(span => span.runtime === 'ci' && Option.isSome(span.duration)),
							Array.map(span => `${span.traceId}:${span.spanId}`)
						)
					)
					const spans = Array.filter(
						incoming.spans,
						span =>
							!(
								span.runtime === 'ci' &&
								Option.isNone(span.duration) &&
								HashSet.has(completed, `${span.traceId}:${span.spanId}`)
							)
					)
					yield* saveExport({links: incoming.links, spans, traces: touchedTraces(spans, stored, receivedAt)})
				},
				Reactivity.mutation(['telemetry']),
				sql.withTransaction,
				asTelemetryError,
				withReactivity
			),
			listOperations: Effect.fn('Telemetry.listOperations')(function* (input: ListOperationsParams) {
				return operationsAnswer(yield* readOverview(input.since), input.app)
			}, asTelemetryError),
			// Aggregate completed action spans selected by listLatencies; return their count, failures and durations rounded to tenths of a millisecond.
			measureLatency: Effect.fn('Telemetry.measureLatency')(function* (input: MeasureLatencyParams) {
				const rows = Array.filter(
					yield* listLatencies({
						cutoff: rangeStart(input.since, yield* DateTime.now),
						name: input.name,
						services: yield* servicesOf(input.app)
					}),
					row => Option.isSome(row.duration)
				)
				const latency = latencyOf(Array.getSomes(Array.map(rows, row => row.duration)))
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
			reject: Effect.fn('Telemetry.reject')(function* (input: RejectedExport) {
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
			watch: (range: TimeFrame) => Stream.unwrap(Cache.get(overviews, range)),
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
				// fallow-ignore-next-line code-duplication -- Each migration spells out the shapes it creates; migrations never share statements.
				'0001_telemetry': Effect.gen(function* () {
					// fallow-ignore-next-line code-duplication -- Each migration spells out the shapes it creates; migrations never share statements.
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
				}),
				// Senders and statements stored once, rows keyed by integers and blobs, and search kept by triggers; one statement per table over every row, since it runs on a full database at start.
				'0002_interned': Effect.gen(function* () {
					// fallow-ignore-next-line code-duplication -- Each migration spells out the shapes it creates; migrations never share statements.
					const sql = yield* SqlClient.SqlClient
					yield* sql`DROP TABLE releases`
					yield* sql`ALTER TABLE span_links RENAME TO old_span_links`
					yield* sql`ALTER TABLE logs RENAME TO old_logs`
					yield* sql`ALTER TABLE spans RENAME TO old_spans`
					yield* sql`ALTER TABLE traces RENAME TO old_traces`
					yield* sql`
						CREATE TABLE resources (
							id INTEGER PRIMARY KEY NOT NULL,
							service TEXT NOT NULL,
							runtime TEXT NOT NULL,
							run INTEGER,
							version TEXT
						) STRICT
					`
					// UNIQUE keeps NULLs apart, so an absent run or release compares as a marker no real one takes.
					yield* sql`
						CREATE UNIQUE INDEX resources_by_sender ON resources (service, runtime, ifnull(run, 0), ifnull(version, ''))
					`
					yield* sql`CREATE TABLE statements (id INTEGER PRIMARY KEY NOT NULL, text TEXT NOT NULL UNIQUE) STRICT`
					yield* sql`
						CREATE TABLE traces (
							id INTEGER PRIMARY KEY NOT NULL,
							traceId BLOB UNIQUE,
							resource INTEGER NOT NULL,
							name TEXT NOT NULL,
							label TEXT,
							start REAL NOT NULL,
							duration REAL NOT NULL,
							spans INTEGER NOT NULL,
							broken BLOB,
							rooted INTEGER NOT NULL,
							waits INTEGER NOT NULL,
							receivedAt INTEGER NOT NULL
						) STRICT
					`
					yield* sql`
						CREATE TABLE spans (
							id INTEGER PRIMARY KEY NOT NULL,
							trace INTEGER NOT NULL,
							span BLOB NOT NULL,
							parent BLOB,
							resource INTEGER NOT NULL,
							name TEXT NOT NULL,
							kind INTEGER NOT NULL,
							start REAL NOT NULL,
							duration REAL,
							status INTEGER NOT NULL,
							error TEXT,
							exception TEXT,
							statement INTEGER,
							attributes TEXT NOT NULL,
							UNIQUE (trace, span)
						) STRICT
					`
					yield* sql`
						CREATE TABLE logs (
							id INTEGER PRIMARY KEY NOT NULL,
							trace INTEGER NOT NULL,
							span BLOB,
							resource INTEGER NOT NULL,
							time REAL NOT NULL,
							severity INTEGER NOT NULL,
							message TEXT NOT NULL,
							attributes TEXT NOT NULL
						) STRICT
					`
					yield* sql`
						CREATE TABLE span_links (
							trace INTEGER NOT NULL,
							span BLOB NOT NULL,
							linkedTrace BLOB NOT NULL,
							linkedSpan BLOB NOT NULL,
							PRIMARY KEY (trace, span, linkedTrace, linkedSpan)
						) STRICT, WITHOUT ROWID
					`
					yield* sql`
						INSERT INTO resources (service, runtime, run, version)
						SELECT service, runtime, run, version FROM old_spans
						UNION
						SELECT service, runtime, run, version FROM old_logs
					`
					yield* sql`
						INSERT INTO statements (text)
						SELECT DISTINCT attributes ->> '$."db.query.text"' FROM old_spans
						WHERE json_type(attributes, '$."db.query.text"') = 'text'
					`
					// Ids in arrival order: each trace with its root's sender, name and label, then a trace for each log trace id no span brought, and one per export for logs without one.
					yield* sql`
						INSERT INTO traces (traceId, resource, name, label, start, duration, spans, broken, rooted, waits, receivedAt)
						SELECT traceId, resource, name, label, start, duration, spans, broken, rooted, waits, receivedAt FROM (
							SELECT
								unhex(old.id) AS traceId, resources.id AS resource, root.name,
								iif(json_type(root.attributes, '$."trace.label"') = 'text', root.attributes ->> '$."trace.label"', NULL) AS label,
								old.start, old.duration, (SELECT count(*) FROM old_spans WHERE traceId = old.id) AS spans,
								unhex(old.broken) AS broken, old.rooted, old.waits, old.receivedAt
							FROM old_traces AS old
							JOIN old_spans AS root ON root.traceId = old.id AND root.spanId = old.root
							JOIN resources ON resources.service = root.service AND resources.runtime = root.runtime
								AND resources.run IS root.run AND resources.version IS root.version
							UNION ALL
							SELECT unhex(log.traceId), min(resources.id), '', NULL, min(log.time), 0, 0, NULL, 0, 1, min(log.receivedAt)
							FROM old_logs AS log
							JOIN resources ON resources.service = log.service AND resources.runtime = log.runtime
								AND resources.run IS log.run AND resources.version IS log.version
							WHERE NOT EXISTS (
								SELECT 1 FROM old_traces AS old JOIN old_spans AS root ON root.traceId = old.id AND root.spanId = old.root
								WHERE old.id = log.traceId
							)
							GROUP BY log.traceId, iif(log.traceId IS NULL, log.receivedAt, NULL)
						)
						ORDER BY receivedAt
					`
					// A waiting trace's root counts as a stream, as ingestion marks it.
					yield* sql`
						INSERT INTO spans (trace, span, parent, resource, name, kind, start, duration, status, error, exception, statement, attributes)
						SELECT
							traces.id, unhex(span.spanId), unhex(span.parentSpanId), resources.id, span.name,
							CASE
								WHEN span.attributes ->> '$."rpc.stream"' = 1 THEN 1
								WHEN span.attributes ->> '$."machine.invoke.kind"' = 'Timer' THEN 2
								WHEN span.name = (span.attributes ->> '$."http.request.method"') || ' (no route)' THEN 3
								WHEN old.waits AND old.root = span.spanId THEN 1
								ELSE 0
							END,
							span.start, span.duration, CASE span.status WHEN 'failed' THEN 1 WHEN 'denied' THEN 2 ELSE 0 END,
							span.error, span.exception, statements.id,
							json_remove(
								span.attributes, '$."db.query.text"', '$."db.system.name"', '$."effect.sql.method"',
								'$."rpc.system.name"', '$."url.scheme"', '$."server.address"', '$."server.port"', '$."url.path"'
							)
						FROM old_spans AS span
						JOIN old_traces AS old ON old.id = span.traceId
						JOIN traces ON traces.traceId = unhex(span.traceId)
						JOIN resources ON resources.service = span.service AND resources.runtime = span.runtime
							AND resources.run IS span.run AND resources.version IS span.version
						LEFT JOIN statements ON statements.text = span.attributes ->> '$."db.query.text"'
						ORDER BY traces.id, span.start
					`
					// A log's id is the integer of its digest's first twelve hex digits, as ingestion reads its first six bytes.
					yield* sql`
						WITH RECURSIVE digit (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM digit WHERE n < 12)
						INSERT INTO logs (id, trace, span, resource, time, severity, message, attributes)
						SELECT
							(SELECT sum((instr('0123456789abcdef', substr(log.id, n, 1)) - 1) << (48 - 4 * n)) FROM digit),
							coalesce(
								(SELECT id FROM traces WHERE traceId = unhex(log.traceId)),
								(SELECT id FROM traces WHERE traceId IS NULL AND receivedAt = log.receivedAt)
							),
							unhex(log.spanId), resources.id, log.time, log.severity, log.message, log.attributes
						FROM old_logs AS log
						JOIN resources ON resources.service = log.service AND resources.runtime = log.runtime
							AND resources.run IS log.run AND resources.version IS log.version
						WHERE true
						ORDER BY 1
						ON CONFLICT DO NOTHING
					`
					yield* sql`
						INSERT INTO span_links (trace, span, linkedTrace, linkedSpan)
						SELECT traces.id, unhex(link.spanId), unhex(link.linkedTraceId), unhex(link.linkedSpanId)
						FROM old_span_links AS link JOIN traces ON traces.traceId = unhex(link.traceId)
					`
					yield* sql`DROP TABLE old_span_links`
					yield* sql`DROP TABLE old_logs`
					yield* sql`DROP TABLE old_spans`
					yield* sql`DROP TABLE old_traces`
					yield* sql`CREATE INDEX traces_by_start ON traces (start) WHERE NOT waits`
					yield* sql`CREATE INDEX traces_by_received ON traces (receivedAt)`
					yield* sql`CREATE INDEX spans_by_name ON spans (name, start) WHERE kind = 0`
					yield* sql`CREATE INDEX spans_by_resource ON spans (resource, start)`
					yield* sql`CREATE INDEX logs_by_time ON logs (time)`
					yield* sql`CREATE INDEX logs_by_trace ON logs (trace)`
					yield* sql`CREATE INDEX logs_by_resource ON logs (resource, time)`
					yield* sql`CREATE INDEX span_links_by_linked ON span_links (linkedTrace)`
					// The indexes read their text from the rows themselves; triggers keep them in step with every write.
					yield* sql`
						CREATE VIRTUAL TABLE span_search USING fts5 (
							name, attributes, error, exception, content = 'spans', content_rowid = 'id', columnsize = 0
						)
					`
					yield* sql`INSERT INTO span_search (span_search) VALUES ('rebuild')`
					yield* sql`
						CREATE VIRTUAL TABLE log_search USING fts5 (
							message, attributes, content = 'logs', content_rowid = 'id', columnsize = 0
						)
					`
					yield* sql`INSERT INTO log_search (log_search) VALUES ('rebuild')`
					yield* sql`
						CREATE TRIGGER spans_indexed AFTER INSERT ON spans BEGIN
							INSERT INTO span_search (rowid, name, attributes, error, exception)
							VALUES (new.id, new.name, new.attributes, new.error, new.exception);
						END
					`
					yield* sql`
						CREATE TRIGGER spans_reindexed AFTER UPDATE OF name, attributes, error, exception ON spans BEGIN
							INSERT INTO span_search (span_search, rowid, name, attributes, error, exception)
							VALUES ('delete', old.id, old.name, old.attributes, old.error, old.exception);
							INSERT INTO span_search (rowid, name, attributes, error, exception)
							VALUES (new.id, new.name, new.attributes, new.error, new.exception);
						END
					`
					yield* sql`
						CREATE TRIGGER spans_unindexed AFTER DELETE ON spans BEGIN
							INSERT INTO span_search (span_search, rowid, name, attributes, error, exception)
							VALUES ('delete', old.id, old.name, old.attributes, old.error, old.exception);
						END
					`
					// Logs are never updated: a stored digest ignores its retry.
					yield* sql`
						CREATE TRIGGER logs_indexed AFTER INSERT ON logs BEGIN
							INSERT INTO log_search (rowid, message, attributes) VALUES (new.id, new.message, new.attributes);
						END
					`
					yield* sql`
						CREATE TRIGGER logs_unindexed AFTER DELETE ON logs BEGIN
							INSERT INTO log_search (log_search, rowid, message, attributes)
							VALUES ('delete', old.id, old.message, old.attributes);
						END
					`
				}),
				'0003_overview': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`CREATE INDEX traces_by_operation_duration ON traces (name, duration DESC, start, id) WHERE NOT waits`
					yield* sql`CREATE INDEX traces_by_operation_failure ON traces (name, start DESC, duration DESC, id) WHERE NOT waits AND broken IS NOT NULL`
				})
			}),
			table: 'telemetry_migrations'
		})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}
