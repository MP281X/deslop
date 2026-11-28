import type {Cause} from 'effect'
import {
	Array,
	Cache,
	Context,
	DateTime,
	Duration,
	Effect,
	Equal,
	Function,
	Layer,
	Option,
	Order,
	Record,
	Schema,
	Scope,
	Stream,
	String,
	Struct,
	SubscriptionRef,
	pipe
} from 'effect'

import type {SqlError} from 'effect/sql'
import {Migrator, SqlClient, SqlSchema} from 'effect/sql'

import {liveRead} from '@deslop/runtime/shared/live-read'
import {TimeFrame, timeFrameDuration} from '@deslop/runtime/shared/time'

import {
	AppName,
	CountedOperation,
	Log,
	OperationTrace,
	Overview,
	RetainedService,
	ServiceName,
	Span,
	SpanLink,
	TelemetryError,
	TraceDetail,
	TraceId,
	TraceIds,
	TraceTree,
	appName,
	rangeStart
} from './contract.ts'
import {migrations} from './migrations.ts'
import {diagnosis, overviewOf, traceTree} from './tree.ts'

const UNAVAILABLE = 'The telemetry storage could not be read or written.'

export const MISSING =
	'No kept telemetry has this trace id: check the id, check ingestion with check_ingestion, or reproduce it if it is older than thirty days.'

export const asTelemetryError = Effect.mapError(
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

export function traceKey(id: TraceId) {
	return `trace:${id}` as const
}

// The tables and the live reads the page and the tools build on: what is stored, as the page watches it.
export class Telemetry extends Context.Service<Telemetry>()('@deslop/scope/telemetry/server/Telemetry', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient

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
		// Keep unrouted HTTP traces searchable, but scanners are not application operations.
		const operationTrace = sql`NOT traces.waits AND traces.name NOT LIKE '% (no route)'`
		// The trace ids of a JSON array, as a subquery `IN` reads.
		function traceIds(ids: string) {
			return sql`(SELECT unhex(value) FROM json_each(${ids}))`
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
		const component = Effect.fn('Telemetry.read')(function* (id: TraceId) {
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

		return {
			// The pieces of SQL the tools' queries share with the page's.
			fragments: {logColumns, logFrom, percentiles, traceFrom},
			// The traces read together, in one order, and their tree.
			read: component,
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
