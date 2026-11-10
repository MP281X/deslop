import {Tool, Toolkit} from 'effect/ai'

import {
	FindTracesParams,
	IngestionAnswer,
	LatencyAnswer,
	ListOperationsParams,
	LogsAnswer,
	MeasureLatencyParams,
	OperationsAnswer,
	ReadTraceAnswer,
	ReadTraceParams,
	SearchLogsParams,
	TelemetryError,
	TracesAnswer
} from '#services/telemetry/schema.ts'

export const Tools = Toolkit.make(
	Tool.make('list_operations', {
		description:
			'Start here to see what is failing or slow in an app: the page’s own operations for the chosen window, failing first, with runs, failures, p50 and p95 milliseconds, the slowest trace and one failure. Denied sign-ins are not failures.',
		failure: TelemetryError,
		parameters: ListOperationsParams,
		success: OperationsAnswer
	}).annotate(Tool.Readonly, true),
	Tool.make('find_traces', {
		description:
			'Search for traces of a request, action or job by app, operation, span name, error or text, newest or slowest first. Each row is one line with its full id, operation, app, side, start time, duration, span count and failing span with its message.',
		failure: TelemetryError,
		parameters: FindTracesParams,
		success: TracesAnswer
	}).annotate(Tool.Readonly, true),
	Tool.make('read_trace', {
		description:
			'Open one trace to see where its time went or why it failed: spans in tree order with offsets, durations, errors, denied spans, attributes and logs, keeping the failing span’s ancestors and the longest spans when over the limit. Logs outside a span follow the spans.',
		failure: TelemetryError,
		parameters: ReadTraceParams,
		success: ReadTraceAnswer
	}).annotate(Tool.Readonly, true),
	Tool.make('search_logs', {
		description:
			'Find log lines by text, app, level or trace, newest first, with time, app, side, level, message and correlation ids. Use it when a trace explains what failed but not why.',
		failure: TelemetryError,
		parameters: SearchLogsParams,
		success: LogsAnswer
	}).annotate(Tool.Readonly, true),
	Tool.make('measure_latency', {
		description:
			'Measure a span’s latency before and after a change: count, failures, p50, p95 and max milliseconds for spans with this exact name over the chosen window. Denied sign-ins are not failures.',
		failure: TelemetryError,
		parameters: MeasureLatencyParams,
		success: LatencyAnswer
	}).annotate(Tool.Readonly, true),
	Tool.make('check_ingestion', {
		description:
			'Use when an app’s telemetry is missing or stale: each service’s app, side, release, run start, last event and entry count, plus rejected exports. A service absent here sent nothing in the last three days.',
		failure: TelemetryError,
		success: IngestionAnswer
	}).annotate(Tool.Readonly, true)
)
