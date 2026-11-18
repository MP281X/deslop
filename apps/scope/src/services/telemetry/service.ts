import type {Cause} from 'effect'
import {
	Array,
	Boolean,
	Cache,
	Context,
	DateTime,
	Duration,
	Effect,
	Equal,
	Function,
	HashMap,
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
	SubscriptionRef,
	pipe
} from 'effect'

import {Digest} from 'effect/crypto'
import {Reactivity} from 'effect/reactivity'
import type {SqlError, Statement} from 'effect/sql'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {liveRead} from '@deslop/runtime/shared/live-read'
import {TimeFrame, timeFrameDuration} from '@deslop/runtime/shared/time'

import {migrations} from './migrations.ts'

import {
	appName,
	attributesFlat,
	diagnosis,
	levelOf,
	logOf,
	overviewOf,
	sideOf,
	senderOf,
	spansOf,
	traceTree
} from '#services/telemetry/lib/utils.ts'
import type {
	CompactLog,
	LogFacts,
	RejectedExport,
	FindTracesParams,
	IngestionAnswer,
	ListOperationsParams,
	LogsAnswer,
	LogsRequest,
	MeasureLatencyParams,
	Operation,
	OperationRow,
	OperationsAnswer,
	ReadTraceAnswer,
	ReadTraceParams,
	Rejection,
	SearchLogsParams,
	TraceRow,
	TracesAnswer,
	TracesRequest,
	SpanId
} from '#services/telemetry/schema.ts'
import {
	AppName,
	ServiceName,
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
	OperationTrace,
	Overview,
	LatencyAnswer,
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

const asTelemetryError = Effect.mapError(
	(cause: SqlError.SqlError | Schema.SchemaError | Cause.NoSuchElementError | TelemetryError) =>
		TelemetryError.make({cause, message: UNAVAILABLE})
)

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly telemetry: never
		// One trace's readers, so an open trace reads again only when it or a trace linked to it changes.
		readonly [trace: `trace:${string}`]: never
	}
}

function traceKey(id: TraceId) {
	return `trace:${id}` as const
}

// One phrase whose last word may be a prefix, so a word still being typed matches.
function phrase(text: string) {
	return `"${String.replaceAll('"', '""')(text)}"*`
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
					failedTraces: Option.liftPredicate(operation.failures, count => count > 0),
					failure: latestFailure(operation),
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
	return {at: log.time, level: levelOf(log.severity), message: log.message, span: log.spanId} satisfies CompactLog
}

type TreeSpan = TraceTree['spans'][number]

function compactSpan(span: TreeSpan, read: TraceId) {
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
		side,
		trace: Option.liftPredicate(span.traceId, id => id !== read)
	}
}

function readTraceAnswer(
	tree: TraceTree,
	limit: number,
	offset: number,
	details: boolean,
	selectedSpanId: Option.Option<SpanId>,
	at: DateTime.Utc
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
				Boolean.match({onFalse: () => [], onTrue: () => [compactSpan(span, tree.id)]})
			)
		}
		if (details || HashSet.has(kept, span.spanId)) return [compactSpan(span, tree.id)]
		return []
	})
	const logs = Array.map(tree.logs, compactLog)
	const omitted = tree.spans.length - spans.length
	return {
		at,
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

		// Ids are blobs in SQL and hex outside; `nullif` turns `hex(NULL)`'s '' back into an absence.
		const spanColumns = sql`
			lower(hex(traces.traceId)) AS traceId, lower(hex(spans.span)) AS spanId,
			nullif(lower(hex(spans.parent)), '') AS parentSpanId,
			resources.service, resources.runtime, resources.run, resources.version,
			spans.name, spans.start, spans.duration, CASE spans.status WHEN 1 THEN 'failed' WHEN 2 THEN 'denied' ELSE 'ok' END AS status, spans.error, spans.exception,
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
		// The trace and every trace a span link joins to it, either way, up to 64 traces, so one open trace never reads a whole chain of runs.
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
					LIMIT 64
				)
				SELECT lower(hex(id)) AS id FROM linked
			`
		})

		// The distinct senders a batch names at this JSON path, added when new; UNIQUE keeps NULLs apart, so the index compares markers for an absent run or version.
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
		// A span's own kind, from what it carries: the constant keys it reads are never stripped from stored attributes.
		function kindOf(attributes: Statement.Fragment, name: Statement.Fragment) {
			return sql`CASE
				WHEN ${attributes} ->> '$."rpc.stream"' = 1 THEN 1
				WHEN ${attributes} ->> '$."machine.invoke.kind"' = 'Timer' THEN 2
				WHEN ${name} = (${attributes} ->> '$."http.request.method"') || ' (no route)' THEN 3
				ELSE 0
			END`
		}
		// Batch upsert the export, then refresh only its traces through indexed boundary, root and failure lookups.
		const saveExport = SqlSchema.void({
			Request: Schema.fromJsonString(
				Schema.Struct({links: Schema.Array(SpanLink), receivedAt: Trace.fields.receivedAt, spans: Schema.Array(Span)})
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
						INSERT INTO traces (traceId, resource, name, start, duration, spans, rooted, waits, receivedAt, end)
						SELECT
							unhex(arriving.value ->> 'traceId'), min(resources.id), '', min(arriving.value ->> 'start'), 0, 0, 0, 1,
							${batch} ->> 'receivedAt', min(arriving.value ->> 'start')
						FROM json_each(${batch}, '$.spans') AS arriving JOIN resources ON ${arrivingSender}
						WHERE true
						GROUP BY arriving.value ->> 'traceId'
						ON CONFLICT (traceId) DO NOTHING
					`
					// Replace retried spans except a late CI start after completion; strip the listed attributes and intern SQL statements.
					yield* sql`
						INSERT INTO spans (trace, span, parent, resource, name, kind, start, duration, status, error, exception, statement, attributes)
						SELECT
							traces.id, unhex(arriving.value ->> 'spanId'), unhex(arriving.value ->> 'parentSpanId'), resources.id,
							arriving.value ->> 'name', ${kindOf(arrivingAttributes, sql`arriving.value ->> 'name'`)},
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
						WHERE NOT (excluded.duration IS NULL AND spans.duration IS NOT NULL
							AND (SELECT runtime FROM resources WHERE id = excluded.resource) = 'ci')
						-- A retry that changes nothing leaves the row and its search entry alone.
						AND (spans.parent, spans.resource, spans.name, spans.kind, spans.start, spans.duration, spans.status,
							spans.error, spans.exception, spans.statement, spans.attributes)
						IS NOT (excluded.parent, excluded.resource, excluded.name, excluded.kind, excluded.start, excluded.duration,
							excluded.status, excluded.error, excluded.exception, excluded.statement, excluded.attributes)
					`
					// Indexed boundary and candidate lookups touch only changed traces, never decode their stored spans. A span sent without a parent outranks one whose parent hasn't arrived, so a late real root still names the trace.
					yield* sql`
						UPDATE traces SET
							end = (SELECT start + coalesce(duration, 0) FROM spans WHERE trace = traces.id
								ORDER BY start + coalesce(duration, 0) DESC LIMIT 1),
							root = coalesce((SELECT candidate.span FROM spans AS candidate WHERE candidate.trace = traces.id
								AND NOT EXISTS (SELECT 1 FROM spans AS parent WHERE parent.trace = traces.id AND parent.span = candidate.parent)
								ORDER BY candidate.parent IS NOT NULL, candidate.start, candidate.id LIMIT 1),
								(SELECT span FROM spans WHERE trace = traces.id ORDER BY start, id LIMIT 1)),
							broken = (SELECT candidate.span FROM spans AS candidate WHERE candidate.trace = traces.id AND candidate.status = 1
								AND NOT EXISTS (SELECT 1 FROM spans AS child WHERE child.trace = traces.id AND child.parent = candidate.span AND child.status = 1)
								ORDER BY candidate.start, candidate.id LIMIT 1),
							rooted = EXISTS (SELECT 1 FROM spans WHERE trace = traces.id AND parent IS NULL)
						WHERE traceId IN (SELECT unhex(value ->> 'traceId') FROM json_each(${batch}, '$.spans'))
					`
					// The operation starts when its root did and lasts until its latest span ends, so a child on a clock behind the root's widens only the drawn envelope.
					yield* sql`
						UPDATE traces SET start = root.start, duration = max(traces.end - root.start, 0),
							resource = root.resource, name = root.name,
							label = CASE WHEN json_type(root.attributes, '$."trace.label"') = 'text' THEN root.attributes ->> '$."trace.label"' END,
							waits = coalesce(root.attributes ->> '$."rpc.stream"' = 1, 0)
								OR coalesce(substr(root.name, 1, 14) = 'Machine.invoke' AND root.attributes ->> '$."machine.invoke.kind"' = 'Timer', 0)
								OR EXISTS (SELECT 1 FROM spans AS child WHERE child.trace = traces.id AND child.parent = root.span
									AND child.attributes ->> '$."rpc.stream"' = 1
									AND root.attributes ->> '$."rpc.method"' != ''
									AND child.attributes ->> '$."rpc.method"' = root.attributes ->> '$."rpc.method"')
						FROM spans AS root WHERE root.trace = traces.id AND root.span = traces.root
						AND traces.traceId IN (SELECT unhex(value ->> 'traceId') FROM json_each(${batch}, '$.spans'))
					`
					// A waiting trace's root counts as a stream; once it no longer waits, or another span becomes its root, each span is its own kind again.
					yield* sql`
						UPDATE spans SET kind = derived.kind FROM (
							SELECT spans.id, CASE WHEN traces.waits AND spans.span = traces.root AND ${kindOf(sql`spans.attributes`, sql`spans.name`)} = 0
								THEN 1 ELSE ${kindOf(sql`spans.attributes`, sql`spans.name`)} END AS kind
							FROM spans JOIN traces ON traces.id = spans.trace
							WHERE traces.traceId IN (SELECT unhex(value ->> 'traceId') FROM json_each(${batch}, '$.spans'))
						) AS derived
						WHERE spans.id = derived.id AND spans.kind != derived.kind
					`
					// A resent span's links replace the ones it sent before.
					yield* sql`
						DELETE FROM span_links WHERE (trace, span) IN (
							SELECT traces.id, unhex(arriving.value ->> 'spanId') FROM json_each(${batch}, '$.spans') AS arriving
							JOIN traces ON traces.traceId = unhex(arriving.value ->> 'traceId')
						)
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
					// A log starts the trace it names when no span of it has arrived; the logs that name none share one trace for their export, made only when one of them is new.
					yield* sql`
						INSERT INTO traces (traceId, resource, name, start, duration, spans, rooted, waits, receivedAt, end)
						SELECT
							unhex(arriving.value ->> 'traceId'), min(resources.id), '', min(arriving.value ->> 'time'), 0, 0, 0, 1,
							min(arriving.value ->> 'receivedAt'), min(arriving.value ->> 'time')
						FROM json_each(${batch}) AS arriving JOIN resources ON ${arrivingSender}
						WHERE arriving.value ->> 'traceId' IS NOT NULL OR NOT EXISTS (SELECT 1 FROM logs WHERE id = arriving.value ->> 'id')
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
		// Retention drops whole traces by when they first arrived, with their spans, logs, links and search entries: those past the cutoff, or without one the 128 oldest. Ids don't follow receipt, since a log export commits after its digests.
		const deleteTraces = SqlSchema.void({
			Request: Schema.OptionFromNullOr(Trace.fields.receivedAt),
			execute: cutoff => {
				const victims = Option.match(Option.fromNullOr(cutoff), {
					onNone: () => sql`(SELECT id FROM traces ORDER BY receivedAt, id LIMIT 128)`,
					onSome: before => sql`(SELECT id FROM traces WHERE receivedAt < ${before})`
				})
				return Effect.all(
					[
						sql`DELETE FROM ${sql(StoredSpanLink.table)} WHERE trace IN ${victims}`,
						sql`DELETE FROM ${sql(StoredLog.table)} WHERE trace IN ${victims}`,
						sql`DELETE FROM ${sql(StoredSpan.table)} WHERE trace IN ${victims}`,
						sql`DELETE FROM ${sql(StoredTrace.table)} WHERE id IN ${victims}`,
						sql`DELETE FROM ${sql(StoredResource.table)} WHERE id NOT IN (SELECT resource FROM traces UNION SELECT resource FROM spans UNION SELECT resource FROM logs)`,
						sql`DELETE FROM ${sql(StoredStatement.table)} WHERE id NOT IN (SELECT statement FROM spans WHERE statement IS NOT NULL)`
					],
					{concurrency: 1, discard: true}
				)
			}
		})
		const retainedSize = SqlSchema.findOne({
			Request: Schema.Void,
			Result: Schema.Struct({bytes: Schema.Finite, traces: Schema.BooleanFromBit}),
			execute: () => sql`SELECT
				(SELECT page_size FROM pragma_page_size) *
				((SELECT page_count FROM pragma_page_count) - (SELECT freelist_count FROM pragma_freelist_count)) AS bytes,
				EXISTS (SELECT 1 FROM traces) AS traces`
		})
		// Live SQLite pages include rows, indexes and search; freed pages are reused, not counted as retained data.
		const boundSize = Effect.gen(function* () {
			const state = {size: yield* retainedSize()}
			// A disk guard, not the retention rule: thirty days at November's rate (about 110 MB a day) fit under 4 GiB, so the oldest traces go first only when a flood would fill the disk.
			while (state.size.bytes > 4 * 1024 * 1024 * 1024 && state.size.traces) {
				yield* deleteTraces(Option.none())
				// FTS deletion markers must be merged before measuring the retained search pages again.
				yield* sql`INSERT INTO span_search (span_search) VALUES ('optimize')`
				yield* sql`INSERT INTO log_search (log_search) VALUES ('optimize')`
				state.size = yield* retainedSize()
			}
		})
		// Nearest-rank latency has one definition for overview and measurement, including empty samples.
		const percentiles = sql`
			coalesce(json_extract(json_group_array(sample.duration ORDER BY sample.duration),
				'$[' || max(0, (count(*) + 1) / 2 - 1) || ']'), 0) AS p50Ms,
			coalesce(json_extract(json_group_array(sample.duration ORDER BY sample.duration),
				'$[' || max(0, (count(*) * 95 + 99) / 100 - 1) || ']'), 0) AS p95Ms
		`
		const OverviewRange = Schema.Struct({
			apps: Schema.fromJsonString(Schema.Record(ServiceName, AppName)),
			cutoff: Span.fields.start,
			settledBefore: Span.fields.start
		})
		const listOperationCounts = SqlSchema.findAll({
			Request: OverviewRange,
			Result: CountedOperation,
			execute: query => sql`
				WITH senders AS MATERIALIZED (
					SELECT root.id, root.runtime, apps.value AS app
					FROM resources AS root JOIN json_each(${query.apps}) AS apps ON apps.key = root.service
				), sample AS (
					SELECT traces.id AS arrival, traces.start, traces.duration,
						senders.app, senders.runtime, traces.name, traces.broken IS NOT NULL AS failed
					FROM traces JOIN senders ON senders.id = traces.resource
					WHERE ${operationTrace} AND traces.start >= ${query.cutoff}
					AND (traces.rooted OR traces.start < ${query.settledBefore})
				)
				SELECT app, runtime, name, count(*) AS count, sum(failed) AS failures, max(start) AS latest, ${percentiles}
				FROM sample GROUP BY app, runtime, name ORDER BY min(start), min(arrival)
			`
		})
		const listKeptTraces = SqlSchema.findAll({
			Request: Schema.Struct({
				...Struct.pick(OverviewRange.fields, ['cutoff', 'settledBefore']),
				...Struct.pick(CountedOperation.fields, ['runtime', 'name']),
				services: Schema.Array(ServiceName)
			}),
			Result: Schema.Struct({
				...Struct.pick(OperationTrace.fields, ['id', 'duration', 'start']),
				...TraceDetail.fields
			}),
			execute: query => {
				const columns = sql`traces.id AS arrival, traces.start, traces.duration`
				const where = sql`${operationTrace} AND traces.name = ${query.name}
					AND root.service IN ${sql.in(query.services)} AND root.runtime = ${query.runtime}
					AND traces.start >= ${query.cutoff} AND (traces.rooted OR traces.start < ${query.settledBefore})`
				return sql`
					WITH failures AS (
						SELECT ${columns} ${traceFrom} WHERE ${where} AND traces.broken IS NOT NULL
						ORDER BY traces.start DESC, traces.duration DESC, traces.id LIMIT 10
					), newest AS (
						SELECT ${columns} ${traceFrom} WHERE ${where}
						ORDER BY traces.start DESC, traces.id DESC LIMIT 5
					), slowest AS (
						SELECT ${columns} ${traceFrom} WHERE ${where}
						ORDER BY traces.duration DESC, traces.start, traces.id LIMIT 20
					), candidates AS (
						SELECT * FROM failures UNION SELECT * FROM newest UNION SELECT * FROM slowest
					), kept AS (
						SELECT * FROM candidates ORDER BY arrival IN (SELECT arrival FROM failures) DESC,
							arrival IN (SELECT arrival FROM newest) DESC, duration DESC, start, arrival LIMIT 20
					)
					SELECT lower(hex(traces.traceId)) AS id, kept.start, kept.duration,
						traces.label, broken.name AS broken, broken.error, broken.exception
					FROM kept JOIN traces ON traces.id = kept.arrival
					LEFT JOIN spans AS broken ON broken.trace = traces.id AND broken.span = traces.broken
					ORDER BY kept.duration DESC, kept.arrival IN (SELECT arrival FROM failures) DESC, kept.start, kept.arrival
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
		// The spans of one name that measure work: a stream, a machine's timer and an unrouted request are kinds of their own.
		const readLatency = SqlSchema.findOne({
			Request: LatencyQuery,
			Result: LatencyAnswer,
			execute: query => sql`
				SELECT count(*) AS count, coalesce(sum(sample.status = 1), 0) AS failedSpans,
					coalesce(max(sample.duration), 0) AS maxMs, ${percentiles}
				FROM spans AS sample JOIN resources ON resources.id = sample.resource
				WHERE sample.kind = 0 AND sample.duration IS NOT NULL AND sample.name = ${query.name} AND sample.start >= ${query.cutoff}
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
			Effect.flatMap(now => deleteTraces(Option.some(DateTime.subtractDuration(now, Duration.days(30))))),
			Effect.andThen(boundSize),
			Reactivity.mutation(['telemetry']),
			sql.withTransaction,
			asTelemetryError,
			withReactivity,
			Effect.withSpan('Telemetry.prune')
		)
		// The overview as of now, counted over every settled trace; a trace whose root never came joins it a minute after it started.
		const readOverview = Effect.fnUntraced(function* (range: TimeFrame) {
			const now = yield* DateTime.now
			const settledBefore = DateTime.subtractDuration(now, Duration.minutes(1))
			const services = yield* listRetainedServices(settledBefore)
			const apps = Record.fromIterableWith(services, row => [row.service, appName(row.service)])
			const query = {apps, cutoff: rangeStart(range, now), settledBefore}
			const operations = yield* Effect.forEach(
				yield* listOperationCounts(query),
				Effect.fnUntraced(function* (operation) {
					const traces = yield* listKeptTraces({
						...query,
						...operation,
						services: Record.keys(Record.filter(apps, app => app === operation.app))
					})
					// Retention may remove this operation after the counts were read.
					if (!Array.isReadonlyArrayNonEmpty(traces)) return Option.none()
					return Option.some({
						...operation,
						traces: Array.map(traces, row => ({
							duration: row.duration,
							failure: Option.map(row.broken, span => ({error: diagnosis(row), span})),
							id: row.id,
							label: row.label,
							start: row.start
						}))
					})
				}),
				{concurrency: 1}
			)
			return overviewOf(Array.getSomes(operations), services)
		})
		// When a quiet frame's overview next changes without a write: its oldest trace leaves the frame, or a trace without a root settles a minute after it started.
		const listChanges = SqlSchema.findOne({
			Request: Schema.Struct(Struct.pick(OverviewRange.fields, ['cutoff', 'settledBefore'])),
			Result: Schema.Struct({
				oldest: Schema.OptionFromNullOr(Span.fields.start),
				unsettled: Schema.OptionFromNullOr(Span.fields.start)
			}),
			execute: query => sql`SELECT
				(SELECT min(start) FROM traces WHERE NOT waits AND start >= ${query.cutoff}) AS oldest,
				(SELECT min(start) FROM traces WHERE NOT waits AND NOT rooted AND start >= ${query.settledBefore}) AS unsettled`
		})
		// A wake-up at that moment, checked at least once a minute since a write can bring an earlier one.
		function settles(range: TimeFrame) {
			return pipe(
				Effect.gen(function* () {
					const now = yield* DateTime.now
					const next = yield* listChanges({
						cutoff: rangeStart(range, now),
						settledBefore: DateTime.subtractDuration(now, Duration.minutes(1))
					})
					const due = pipe(
						[
							Option.map(next.oldest, start => DateTime.addDuration(start, timeFrameDuration(range))),
							Option.map(next.unsettled, start => DateTime.addDuration(start, Duration.minutes(1)))
						],
						Array.getSomes,
						Array.match({
							onEmpty: () => Option.none<DateTime.Utc>(),
							onNonEmpty: times => Option.some(Array.min(times, DateTime.Order))
						})
					)
					const wait = Option.match(due, {
						onNone: () => Duration.minutes(1),
						onSome: at =>
							pipe(DateTime.distance(now, at), Duration.sum(Duration.millis(1)), Duration.min(Duration.minutes(1)))
					})
					yield* Effect.sleep(wait)
					return Option.exists(due, at => DateTime.isLessThanOrEqualTo(at, DateTime.addDuration(now, wait)))
				}),
				Stream.fromEffectRepeat,
				Stream.filter(Function.identity)
			)
		}
		// Cache lookups may run in an RPC's scope; shared sources belong to this service instead.
		const serviceScope = yield* Effect.scope
		const overviews = yield* Cache.make({
			capacity: TimeFrame.literals.length,
			lookup: Effect.fnUntraced(function* (range: TimeFrame) {
				return yield* pipe(
					// liveRead owns buffering and the cooldown; the shared stream replays its latest answer.
					Stream.merge(sql.reactive(['telemetry'], Effect.void), settles(range)),
					liveRead(readOverview(range)),
					Stream.changesWith(Schema.toEquivalence(Overview)),
					Stream.mapError(cause => TelemetryError.make({cause, message: UNAVAILABLE})),
					Stream.withSpan('Telemetry.watch', {attributes: {range, 'rpc.stream': true}}),
					Stream.share({capacity: 1, replay: 1, strategy: 'sliding'}),
					Effect.provideService(Scope.Scope, serviceScope)
				)
			})
		})
		// The traces read together, in one order, and their tree.
		const component = Effect.fnUntraced(function* (id: TraceId) {
			const traceId = TraceId.make(String.toLowerCase(id))
			const ids = pipe(
				yield* listLinkedTraces(traceId),
				Array.map(row => row.id),
				Array.sort(Order.String)
			)
			const spans = yield* listSpans(ids)
			const logs = yield* listLogs(ids)
			if (Array.isReadonlyArrayEmpty(spans) && Array.isReadonlyArrayEmpty(logs)) {
				return yield* TelemetryError.make({message: MISSING})
			}
			return {ids, tree: traceTree(traceId, spans, logs, yield* listLinks(ids))}
		})
		function tree(id: TraceId) {
			return Effect.map(component(id), read => read.tree)
		}

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
								// All logs in the group share one sender, regardless of instrumentation scope.
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
						Effect.flatMap(
							Effect.forEach(
								Effect.fnUntraced(function* (item) {
									const log = yield* Schema.encodeEffect(ExportedLog)(item.log)
									// Retries must deduplicate even if the exporter changes how it writes absent fields.
									const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
										attributes: log.attributes ?? [],
										body: log.body ?? {},
										observedTimeUnixNano: log.observedTimeUnixNano ?? '',
										resource: Option.getOrElse(item.resource, () => ({})),
										severityNumber: log.severityNumber,
										severityText: log.severityText ?? '',
										spanId: log.spanId ?? '',
										timeUnixNano: log.timeUnixNano ?? '',
										traceId: log.traceId ?? ''
									})
									return {encoded, item}
								}),
								{concurrency: 1}
							)
						),
						Effect.flatMap(items =>
							Effect.forEach(
								// A record has no id of its own: its identity is what it carries and how many equal records came before it in its export, so a retried export matches and two equal lines both stay.
								Array.mapAccum(items, HashMap.empty<string, number>(), (seen, entry) => {
									const occurrence = pipe(seen, HashMap.get(entry.encoded), Option.getOrElse(Function.constant(0)))
									return [HashMap.set(seen, entry.encoded, occurrence + 1), {...entry, occurrence}] as const
								})[1],
								Effect.fnUntraced(function* (entry) {
									// The digest's first 53 bits, read as one integer exact in a number.
									const bytes = yield* digest.digest(Digest.sha256, utf8.encode(`${entry.occurrence}:${entry.encoded}`))
									return logOf(
										entry.item.sender,
										entry.item.log,
										LogId.make(
											Array.reduce(bytes.subarray(1, 7), (bytes[0] ?? 0) % 32, (value, byte) => value * 256 + byte)
										),
										receivedAt
									)
								}),
								{concurrency: 1}
							)
						)
					)
					yield* sql.withTransaction(Effect.andThen(saveLogs(logs), boundSize))
					yield* Reactivity.invalidate([
						'telemetry',
						...pipe(Array.getSomes(Array.map(logs, log => log.traceId)), Array.dedupe, Array.map(traceKey))
					])
				},
				asTelemetryError,
				withReactivity
			),
			// One commit per export, and the pages read again only after it.
			ingestTraces: Effect.fn('Telemetry.ingestTraces')(
				function* (payload: TracesRequest) {
					const receivedAt = yield* DateTime.now
					const rows = spansOf(payload)
					yield* saveExport({...rows, receivedAt})
					yield* boundSize
					// The traces it wrote and those it links into, whose readers now hold a new linked trace.
					yield* Reactivity.invalidate([
						'telemetry',
						...pipe(
							[...Array.map(rows.spans, span => span.traceId), ...Array.map(rows.links, link => link.linkedTraceId)],
							Array.dedupe,
							Array.map(traceKey)
						)
					])
				},
				sql.withTransaction,
				asTelemetryError,
				withReactivity
			),
			listOperations: Effect.fn('Telemetry.listOperations')(function* (input: ListOperationsParams) {
				const overview = yield* Effect.fromOption(
					yield* Stream.runHead(Stream.unwrap(Cache.get(overviews, input.since)))
				)
				return operationsAnswer(overview, input.app)
			}, asTelemetryError),
			// Aggregate completed action spans; return their count, failures and durations rounded to tenths of a millisecond.
			measureLatency: Effect.fn('Telemetry.measureLatency')(function* (input: MeasureLatencyParams) {
				const measured = yield* readLatency({
					cutoff: rangeStart(input.since, yield* DateTime.now),
					name: input.name,
					services: yield* servicesOf(input.app)
				})
				return {
					...measured,
					...pipe(
						measured,
						Struct.pick(['maxMs', 'p50Ms', 'p95Ms']),
						Record.map(duration => Duration.millis(Number.round(Duration.toMillis(duration), 1)))
					)
				}
			}, asTelemetryError),
			readTrace: Effect.fn('Telemetry.readTrace')(function* (
				input: ReadTraceParams,
				offset: number = 0,
				spanId: Option.Option<SpanId> = Option.none(),
				details: boolean = false
			) {
				const value = yield* tree(input.id)
				return readTraceAnswer(
					value,
					input.limit,
					offset,
					details,
					spanId,
					yield* Option.match(
						pipe(
							value.spans,
							Array.map(span => span.start),
							Array.match({
								onEmpty: () => Option.map(Array.head(value.logs), log => log.time),
								onNonEmpty: starts => Option.some(Array.min<DateTime.Utc>(starts, DateTime.Order))
							})
						),
						{onNone: () => TelemetryError.make({message: MISSING}), onSome: Effect.succeed}
					)
				)
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
							id: log.id,
							level: levelOf(log.severity),
							message: log.message,
							side,
							span: log.spanId,
							trace: log.traceId
						}
					}),
					nextCursor: Option.map(page.last, Struct.pick(['id', 'time']))
				} satisfies LogsAnswer
			}, asTelemetryError),
			// A trace and every trace a span link joins to it, as one tree.
			trace: Effect.fn('Telemetry.trace')(tree, asTelemetryError),
			// What the page watches: read again after each committed write, at most once a second, always the newest.
			watch: (range: TimeFrame) => Stream.unwrap(Cache.get(overviews, range)),
			// An open trace reads again only after a write to one of the traces it shows; a read that finds a newly linked trace listens to it too.
			watchTrace: (id: TraceId) =>
				pipe(
					Stream.fromEffect(SubscriptionRef.make<readonly TraceId[]>([TraceId.make(String.toLowerCase(id))])),
					Stream.flatMap(shown =>
						pipe(
							SubscriptionRef.changes(shown),
							Stream.changesWith(Array.makeEquivalence(Equal.asEquivalence<TraceId>())),
							Stream.switchMap(ids => sql.reactive(Array.map(ids, traceKey), Effect.void)),
							liveRead(
								pipe(
									component(id),
									Effect.tap(read => SubscriptionRef.set(shown, read.ids)),
									Effect.map(read => read.tree)
								)
							)
						)
					),
					Stream.changesWith(Schema.toEquivalence(TraceTree)),
					Stream.mapError(cause => TelemetryError.make({cause, message: UNAVAILABLE})),
					Stream.withSpan('Telemetry.watchTrace', {attributes: {id, 'rpc.stream': true}})
				)
		}
	})
}) {
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({loader: Migrator.fromRecord(migrations), table: 'telemetry_migrations'})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}
