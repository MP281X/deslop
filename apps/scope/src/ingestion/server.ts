import {
	Array,
	Context,
	DateTime,
	Duration,
	Effect,
	Function,
	HashMap,
	Layer,
	Option,
	Record,
	Ref,
	Schedule,
	Schema,
	Struct,
	pipe
} from 'effect'

import {Digest} from 'effect/crypto'
import {Reactivity} from 'effect/reactivity'
import type {Statement} from 'effect/sql'
import {SqlClient, SqlSchema} from 'effect/sql'

import {ExportedLog, Resource, ServiceRun} from './contract.ts'
import type {IngestionAnswer, LogsRequest, Origin, RejectedExport, Rejection, TracesRequest} from './contract.ts'
import {admittedSender, logOf, logTimeOf, senderOf, skewOf, spansOf} from './otlp.ts'

import {
	Log,
	LogId,
	Span,
	SpanLink,
	StoredLog,
	StoredResource,
	StoredSpan,
	StoredSpanLink,
	StoredStatement,
	StoredTrace,
	Trace,
	appName,
	sideOf
} from '#telemetry/contract.ts'
import {Telemetry, asTelemetryError, traceKey} from '#telemetry/server.ts'

export class Ingestion extends Context.Service<Ingestion>()('@deslop/scope/ingestion/server/Ingestion', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const digest = yield* Digest.Digest
		const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)
		const utf8 = new TextEncoder()
		const rejections = yield* Ref.make(Record.empty<string, Rejection>())

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
				Schema.Struct({
					identified: Schema.Boolean,
					links: Schema.Array(SpanLink),
					receivedAt: Trace.fields.receivedAt,
					spans: Schema.Array(Span)
				})
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
					// An identified span replacing an anonymous one makes its trace as new as this export, so retention keeps it.
					yield* sql`
						UPDATE traces SET receivedAt = ${batch} ->> 'receivedAt'
						WHERE ${batch} ->> 'identified' AND id IN (
							SELECT spans.trace FROM json_each(${batch}, '$.spans') AS arriving
							JOIN traces AS arrived ON arrived.traceId = unhex(arriving.value ->> 'traceId')
							JOIN spans ON spans.trace = arrived.id AND spans.span = unhex(arriving.value ->> 'spanId')
							WHERE NOT spans.identified
						)
					`
					// Replace retried spans except a late CI start after completion, and an identified span by an anonymous export; strip the listed attributes and intern SQL statements.
					yield* sql`
						INSERT INTO spans (trace, span, parent, resource, name, kind, start, duration, status, error, exception, statement, attributes, identified)
						SELECT
							traces.id, unhex(arriving.value ->> 'spanId'), unhex(arriving.value ->> 'parentSpanId'), resources.id,
							arriving.value ->> 'name', ${kindOf(arrivingAttributes, sql`arriving.value ->> 'name'`)},
							arriving.value ->> 'start', arriving.value ->> 'duration',
							CASE arriving.value ->> 'status' WHEN 'failed' THEN 1 WHEN 'denied' THEN 2 ELSE 0 END,
							arriving.value ->> 'error', arriving.value ->> 'exception', statements.id,
							json_remove(
								${arrivingAttributes}, '$."db.query.text"', '$."db.system.name"', '$."effect.sql.method"',
								'$."rpc.system.name"', '$."url.scheme"', '$."server.address"', '$."server.port"', '$."url.path"'
							),
							${batch} ->> 'identified'
						FROM json_each(${batch}, '$.spans') AS arriving
						JOIN traces ON traces.traceId = unhex(arriving.value ->> 'traceId')
						JOIN resources ON ${arrivingSender}
						LEFT JOIN statements ON statements.text = ${arrivingAttributes} ->> '$."db.query.text"'
						WHERE true
						ON CONFLICT (trace, span) DO UPDATE SET
							parent = excluded.parent, resource = excluded.resource, name = excluded.name, kind = excluded.kind,
							start = excluded.start, duration = excluded.duration, status = excluded.status, error = excluded.error,
							exception = excluded.exception, statement = excluded.statement, attributes = excluded.attributes,
							identified = excluded.identified
						WHERE NOT (excluded.duration IS NULL AND spans.duration IS NOT NULL
							AND (SELECT runtime FROM resources WHERE id = excluded.resource) = 'ci')
						AND (excluded.identified OR NOT spans.identified)
						-- A retry that changes nothing leaves the row and its search entry alone.
						AND (spans.parent, spans.resource, spans.name, spans.kind, spans.start, spans.duration, spans.status,
							spans.error, spans.exception, spans.statement, spans.attributes, spans.identified)
						IS NOT (excluded.parent, excluded.resource, excluded.name, excluded.kind, excluded.start, excluded.duration,
							excluded.status, excluded.error, excluded.exception, excluded.statement, excluded.attributes, excluded.identified)
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
					// A late CI start leaves the completed span as it was, so its links stay too.
					const kept = sql`(
						SELECT traces.id, unhex(late.value ->> 'spanId') FROM json_each(${batch}, '$.spans') AS late
						JOIN traces ON traces.traceId = unhex(late.value ->> 'traceId')
						JOIN spans ON spans.trace = traces.id AND spans.span = unhex(late.value ->> 'spanId')
						WHERE late.value ->> 'duration' IS NULL AND late.value ->> 'runtime' = 'ci' AND spans.duration IS NOT NULL
					)`
					// A resent span's links replace the ones it sent before, unless the span it names stayed identified.
					yield* sql`
						DELETE FROM span_links WHERE (trace, span) IN (
							SELECT traces.id, spans.span FROM json_each(${batch}, '$.spans') AS arriving
							JOIN traces ON traces.traceId = unhex(arriving.value ->> 'traceId')
							JOIN spans ON spans.trace = traces.id AND spans.span = unhex(arriving.value ->> 'spanId')
							WHERE ${batch} ->> 'identified' OR NOT spans.identified
						) AND (trace, span) NOT IN ${kept}
					`
					yield* sql`
						INSERT INTO span_links (trace, span, linkedTrace, linkedSpan)
						SELECT
							traces.id, unhex(arriving.value ->> 'spanId'), unhex(arriving.value ->> 'linkedTraceId'),
							unhex(arriving.value ->> 'linkedSpanId')
						FROM json_each(${batch}, '$.links') AS arriving
						JOIN traces ON traces.traceId = unhex(arriving.value ->> 'traceId')
						JOIN spans ON spans.trace = traces.id AND spans.span = unhex(arriving.value ->> 'spanId')
						WHERE (${batch} ->> 'identified' OR NOT spans.identified)
							AND (traces.id, unhex(arriving.value ->> 'spanId')) NOT IN ${kept}
						ON CONFLICT DO NOTHING
					`
				})
		})
		const saveLogs = SqlSchema.void({
			Request: Schema.fromJsonString(Schema.Struct({identified: Schema.Boolean, logs: Schema.Array(Log)})),
			execute: batch =>
				Effect.gen(function* () {
					yield* saveResources(batch, '$.logs')
					// An identified export takes over the digests an anonymous one stored first, and makes their traces as new as itself.
					yield* sql`
						UPDATE traces SET receivedAt = (SELECT min(value ->> 'receivedAt') FROM json_each(${batch}, '$.logs'))
						WHERE ${batch} ->> 'identified' AND id IN (
							SELECT trace FROM logs WHERE NOT identified
							AND id IN (SELECT value ->> 'id' FROM json_each(${batch}, '$.logs'))
						)
					`
					yield* sql`
						DELETE FROM logs WHERE ${batch} ->> 'identified' AND NOT identified
						AND id IN (SELECT value ->> 'id' FROM json_each(${batch}, '$.logs'))
					`
					// A log starts the trace it names when no span of it has arrived; the logs that name none share one trace for their export, made only when one of them is new.
					yield* sql`
						INSERT INTO traces (traceId, resource, name, start, duration, spans, rooted, waits, receivedAt, end)
						SELECT
							unhex(arriving.value ->> 'traceId'), min(resources.id), '', min(arriving.value ->> 'time'), 0, 0, 0, 1,
							min(arriving.value ->> 'receivedAt'), min(arriving.value ->> 'time')
						FROM json_each(${batch}, '$.logs') AS arriving JOIN resources ON ${arrivingSender}
						WHERE arriving.value ->> 'traceId' IS NOT NULL OR NOT EXISTS (SELECT 1 FROM logs WHERE id = arriving.value ->> 'id')
						GROUP BY arriving.value ->> 'traceId'
						ON CONFLICT (traceId) DO NOTHING
					`
					// A retried export carries the same records, whose digests are already stored. The export's own trace is the newest without an id.
					yield* sql`
						INSERT INTO logs (id, trace, span, resource, time, severity, message, attributes, identified)
						SELECT
							arriving.value ->> 'id',
							coalesce(
								(SELECT id FROM traces WHERE traceId = unhex(arriving.value ->> 'traceId')),
								(SELECT max(id) FROM traces WHERE traceId IS NULL)
							),
							unhex(arriving.value ->> 'spanId'), resources.id, arriving.value ->> 'time',
							arriving.value ->> 'severity', arriving.value ->> 'message', arriving.value ->> 'attributes',
							${batch} ->> 'identified'
						FROM json_each(${batch}, '$.logs') AS arriving JOIN resources ON ${arrivingSender}
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

		// Each service's latest run, the one with the newest stored span start or log time (the greater run start settles a tie): what its senders of that run sent, and when they last did.
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
					heard AS (
						SELECT
							service, coalesce(run, 0) AS run,
							row_number() OVER (
								PARTITION BY service ORDER BY max(lastEvent) DESC, coalesce(run, 0) DESC
							) AS place
						FROM sending GROUP BY service, coalesce(run, 0)
					),
					latest AS (SELECT service, run FROM heard WHERE place = 1)
				SELECT
					sending.service, sum(sending.entries) AS entries, max(sending.lastEvent) AS lastEvent,
					max(sending.run) AS run, max(sending.runtime) AS runtime, max(sending.version) AS version
				FROM sending JOIN latest ON latest.service = sending.service AND coalesce(sending.run, 0) = latest.run
				GROUP BY sending.service
				ORDER BY sending.service
			`
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
			Effect.withSpan('Ingestion.prune')
		)

		yield* prune
		yield* pipe(
			prune,
			Effect.ignore({log: 'Error', message: 'Expired telemetry could not be deleted'}),
			Effect.schedule(Schedule.spaced(Duration.hours(1))),
			Effect.forkScoped
		)

		return {
			checkIngestion: Effect.fn('Ingestion.checkIngestion')(function* () {
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
			ingestLogs: Effect.fn('Ingestion.ingestLogs')(
				function* (payload: LogsRequest, origin: Origin) {
					const receivedAt = yield* DateTime.now
					const items = yield* pipe(
						payload.resourceLogs,
						Option.getOrElse(Array.empty<Option.Option.Value<LogsRequest['resourceLogs']>[number]>),
						Effect.forEach(
							Effect.fnUntraced(function* (group) {
								// All logs in the group share one sender, regardless of instrumentation scope.
								const sender = admittedSender(senderOf(group.resource), origin)
								const resource = yield* Effect.transposeOption(
									Option.map(group.resource, Schema.encodeEffect(Resource))
								)
								const records = pipe(
									group.scopeLogs,
									Option.getOrElse(() => []),
									Array.flatMap(scope => Option.getOrElse(scope.logRecords, () => []))
								)
								const skew = skewOf(
									Array.flatMap(records, record => Option.toArray(logTimeOf(record))),
									receivedAt
								)
								return Array.map(records, log => ({log, resource, sender, skew}))
							}),
							{concurrency: 1}
						),
						Effect.map(Array.flatten)
					)
					const admitted = Array.getSomes(
						Array.map(items, item => Option.map(item.sender, sender => ({...item, sender})))
					)
					const logs = yield* pipe(
						admitted,
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
						),
						Effect.flatMap(entries =>
							Effect.forEach(
								// A record has no id of its own: its identity is what it carries and how many equal records came before it in its export, so a retried export matches and two equal lines both stay.
								Array.mapAccum(entries, HashMap.empty<string, number>(), (seen, entry) => {
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
										receivedAt,
										entry.item.skew
									)
								}),
								{concurrency: 1}
							)
						)
					)
					yield* sql.withTransaction(Effect.andThen(saveLogs({identified: origin !== 'anonymous', logs}), boundSize))
					yield* Reactivity.invalidate([
						'telemetry',
						...pipe(Array.getSomes(Array.map(logs, log => log.traceId)), Array.dedupe, Array.map(traceKey))
					])
					// The records its origin may not write, which OTLP answers as rejected.
					return items.length - admitted.length
				},
				asTelemetryError,
				withReactivity
			),
			// One commit per export, and the pages read again only after it; answers how many spans its origin may not write.
			ingestTraces: Effect.fn('Ingestion.ingestTraces')(
				function* (payload: TracesRequest, origin: Origin) {
					const receivedAt = yield* DateTime.now
					const rows = spansOf(payload, origin, receivedAt)
					yield* saveExport({identified: origin !== 'anonymous', links: rows.links, receivedAt, spans: rows.spans})
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
					return rows.rejected
				},
				sql.withTransaction,
				asTelemetryError,
				withReactivity
			),
			reject: Effect.fn('Ingestion.reject')(function* (input: RejectedExport) {
				const now = yield* DateTime.now
				const key = `${input.route}:${input.status}:${input.credential}`
				yield* Ref.update(rejections, current =>
					Record.set(current, key, {...input, count: (current[key]?.count ?? 0) + 1, lastAt: now})
				)
			})
		}
	})
}) {
	static readonly layer = Layer.provide(Layer.effect(this, this.make), Telemetry.migrations)
}
