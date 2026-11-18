import {Effect} from 'effect'

import {SqlClient} from 'effect/sql'

// The tables Telemetry owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
export const migrations = {
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
	}),
	'0004_trace_facts': Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`ALTER TABLE traces ADD COLUMN end REAL NOT NULL DEFAULT 0`
		yield* sql`ALTER TABLE traces ADD COLUMN root BLOB`
		yield* sql`CREATE INDEX spans_by_trace_start ON spans(trace, start, id)`
		yield* sql`CREATE INDEX spans_by_trace_end ON spans(trace, (start + coalesce(duration, 0)) DESC)`
		yield* sql`CREATE INDEX spans_by_trace_failure ON spans(trace, start, id) WHERE status = 1`
		yield* sql`CREATE INDEX spans_by_trace_parent_status ON spans(trace, parent, status)`
		yield* sql`UPDATE traces SET end = start + duration, root = (
				SELECT candidate.span FROM spans AS candidate WHERE candidate.trace = traces.id
				AND NOT EXISTS (SELECT 1 FROM spans AS parent WHERE parent.trace = traces.id AND parent.span = candidate.parent)
				ORDER BY candidate.start, candidate.id LIMIT 1
			)`
		yield* sql`CREATE TRIGGER spans_counted AFTER INSERT ON spans BEGIN
				UPDATE traces SET spans = spans + 1 WHERE id = new.trace;
			END`
	}),
	'0005_overview_newest': Effect.gen(function* () {
		yield* (yield* SqlClient.SqlClient)`CREATE INDEX traces_by_operation_start ON traces (name, start DESC, id DESC) WHERE NOT waits`
	}),
	// A trace starts when its root did, as ingestion now judges it; a child on a clock behind the root's no longer widens its latency.
	'0006_root_timing': Effect.gen(function* () {
		yield* (yield* SqlClient.SqlClient)`
				UPDATE traces SET start = root.start, duration = max(traces.end - root.start, 0)
				FROM spans AS root WHERE root.trace = traces.id AND root.span = traces.root
			`
	})
}
