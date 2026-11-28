import {
	Array,
	Boolean,
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
	Schema,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {SqlClient, SqlSchema} from 'effect/sql'

import {FoundTrace, LatencyAnswer, LatencyQuery, LogQuery, McpServerName, McpToolName, TraceQuery} from './contract.ts'
import type {
	CompactLog,
	FindTracesParams,
	ListOperationsParams,
	LogFacts,
	LogsAnswer,
	MeasureLatencyParams,
	OperationRow,
	OperationsAnswer,
	ReadTraceAnswer,
	ReadTraceParams,
	SearchLogsParams,
	TraceRow,
	TracesAnswer
} from './contract.ts'

import {Log, Span, TelemetryError, TraceId, appName, rangeStart, sideOf} from '#telemetry/contract.ts'
import type {
	AppName,
	Attributes,
	Operation,
	OperationTrace,
	Overview,
	ServiceName,
	SpanId,
	TraceTree
} from '#telemetry/contract.ts'
import {MISSING, Telemetry, asTelemetryError} from '#telemetry/server.ts'
import {diagnosis} from '#telemetry/tree.ts'

const LEVELS = {debug: 5, error: 17, info: 9, warn: 13}

function levelOf(severity: number) {
	if (severity >= 17) return 'error'
	if (severity >= 13) return 'warn'
	if (severity >= 9) return 'info'
	if (severity >= 5) return 'debug'
	return 'trace'
}

// One flat object of primitive attribute values, without keys that only repeat the span or carry no diagnosis.
function attributesFlat(attributes: Attributes, name: string, failedSpan: boolean) {
	const entries = pipe(
		Record.toEntries(attributes),
		Array.flatMap(entry => {
			const value = entry[1]
			if (Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)) {
				return [[entry[0], value] as const]
			}
			return []
		}),
		Array.filter(entry => {
			const key = entry[0]
			const value = entry[1]
			if (
				Array.contains(
					// `url.full` already holds the path, query and host.
					['service.name', 'rpc.system.name', 'url.scheme', 'server.port', 'url.path', 'url.query', 'server.address'],
					key
				) ||
				String.startsWith('code.')(key)
			) {
				return false
			}
			if (key === 'http.request.method' && String.startsWith(`${value}`)(name)) return false
			if (key === 'client.address' && (value === '127.0.0.1' || value === '::1')) return false
			if (key === 'rpc.method' && value === name) return false
			if (key === 'user_agent.original' && !failedSpan) return false
			return value !== name
		})
	)
	return Option.liftPredicate(Record.fromEntries(entries), () => Array.isReadonlyArrayNonEmpty(entries))
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

export class Search extends Context.Service<Search>()('@deslop/scope/search/server/Search', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const telemetry = yield* Telemetry
		const traceJoins = sql`${telemetry.fragments.traceFrom} LEFT JOIN spans AS broken ON broken.trace = traces.id AND broken.span = traces.broken`

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
					SELECT ${telemetry.fragments.logColumns} ${telemetry.fragments.logFrom}
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
					coalesce(max(sample.duration), 0) AS maxMs, ${telemetry.fragments.percentiles}
				FROM spans AS sample JOIN resources ON resources.id = sample.resource
				WHERE sample.kind = 0 AND sample.duration IS NOT NULL AND sample.name = ${query.name} AND sample.start >= ${query.cutoff}
				AND ${Option.match(Option.fromNullOr(query.services), {
					onNone: () => sql`1=1`,
					onSome: services => sql`resources.service IN ${sql.in(services)}`
				})}
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

		return {
			findTraces: Effect.fn('Search.findTraces')(function* (input: FindTracesParams) {
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
			listOperations: Effect.fn('Search.listOperations')(function* (input: ListOperationsParams) {
				return operationsAnswer(
					yield* Effect.fromOption(yield* Stream.runHead(telemetry.watch(input.since))),
					input.app
				)
			}, asTelemetryError),
			// Aggregate completed action spans; return their count, failures and durations rounded to tenths of a millisecond.
			measureLatency: Effect.fn('Search.measureLatency')(function* (input: MeasureLatencyParams) {
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
			readTrace: Effect.fn('Search.readTrace')(function* (
				input: ReadTraceParams,
				offset: number = 0,
				spanId: Option.Option<SpanId> = Option.none(),
				details: boolean = false
			) {
				const read = yield* telemetry.read(input.id)
				return readTraceAnswer(
					read.tree,
					input.limit,
					offset,
					details,
					spanId,
					yield* Option.match(
						pipe(
							read.tree.spans,
							Array.map(span => span.start),
							Array.match({
								onEmpty: () => Option.map(Array.head(read.tree.logs), log => log.time),
								onNonEmpty: starts => Option.some(Array.min<DateTime.Utc>(starts, DateTime.Order))
							})
						),
						{onNone: () => TelemetryError.make({message: MISSING}), onSome: Effect.succeed}
					)
				)
			}, asTelemetryError),
			searchLogs: Effect.fn('Search.searchLogs')(function* (input: SearchLogsParams) {
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
			}, asTelemetryError)
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
