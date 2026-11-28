import {Array, Effect, Schema, Struct, pipe} from 'effect'

import {DateTimeUtcFromFiniteMillis, DurationFromFiniteMillis, TimeFrame} from '@deslop/runtime/shared/time'

import {AppName, Log, LogId, Side, Span, SpanId, Trace, TraceDetail, TraceId} from '#telemetry/contract.ts'

export type McpServerName = typeof McpServerName.Type
export const McpServerName = pipe(Schema.String, Schema.brand('ScopeMcpServerName'))

export type McpToolName = typeof McpToolName.Type
export const McpToolName = pipe(Schema.String, Schema.brand('ScopeMcpToolName'))

// A trace as search_traces answers it, with its span count and the MCP relay it went through.
export type FoundTrace = typeof FoundTrace.Type
export const FoundTrace = Schema.Struct({
	...Struct.pick(Trace.fields, ['duration', 'id', 'name', 'runtime', 'service', 'start']),
	...Struct.omit(TraceDetail.fields, ['label']),
	relay: Schema.OptionFromNullOr(Span.fields.attributes),
	spans: Schema.Int
})

export type LatencyQuery = typeof LatencyQuery.Type
export const LatencyQuery = Schema.Struct({
	cutoff: DateTimeUtcFromFiniteMillis,
	name: Span.fields.name,
	// The services of the app asked for; none for every app.
	services: Schema.OptionFromNullOr(Schema.Array(Span.fields.service))
})

export type LogFacts = typeof LogFacts.Type
export const LogFacts = Schema.Struct(Struct.pick(Log.fields, ['message', 'severity', 'spanId', 'time']))

export type ATTRIBUTE_VALUE = typeof ATTRIBUTE_VALUE.Type
export const ATTRIBUTE_VALUE = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean])

export type ToolAttributes = typeof ToolAttributes.Type
// The tools' attributes: primitive values only, without what only repeats the row.
export const ToolAttributes = Schema.Record(Schema.String, ATTRIBUTE_VALUE)

export type LogLevel = typeof LogLevel.Type
export const LogLevel = Schema.Literals(['debug', 'error', 'info', 'trace', 'warn'])

export type CompactLog = typeof CompactLog.Type
export const CompactLog = Schema.Struct({
	at: Schema.DateTimeUtcFromString.annotate({description: 'ISO-8601 log timestamp.'}),
	level: LogLevel,
	message: Schema.String,
	span: Schema.OptionFromOptionalKey(SpanId.annotate({description: 'Span id the log was written under.'}))
})

export type AppFilter = typeof AppFilter.Type
// The tools' inputs: every field optional except where a tool cannot answer without it.
export const AppFilter = Schema.annotateEncoded<typeof AppName>({
	description: 'App name as list_operations shows it, such as "trips"; omit for every app.'
})(AppName)

export type Since = typeof Since.Type
export const Since = pipe(
	TimeFrame,
	Schema.withDecodingDefaultTypeKey(Effect.succeed('1h' as const)),
	Schema.annotateEncoded({description: `Time window: ${Array.join(TimeFrame.literals, ', ')}; default '1h'.`})
)

export type ListOperationsParams = typeof ListOperationsParams.Type
export const ListOperationsParams = Schema.Struct({app: Schema.OptionFromOptionalKey(AppFilter), since: Since})

export type TraceCursor = typeof TraceCursor.Type
export const TraceCursor = Schema.Struct(Struct.pick(Trace.fields, ['duration', 'id', 'start']))

// One page of search_traces as the database answers it.
export type TraceQuery = typeof TraceQuery.Type
export const TraceQuery = Schema.Struct({
	...Struct.pick(LatencyQuery.fields, ['cutoff', 'services']),
	cursor: Schema.OptionFromNullOr(TraceCursor),
	errors: Schema.Boolean,
	limit: Schema.Int,
	operation: Schema.OptionFromNullOr(Span.fields.name),
	slowest: Schema.Boolean,
	span: Schema.OptionFromNullOr(Span.fields.name),
	text: Schema.OptionFromNullOr(Schema.String)
})

export type FindTracesParams = typeof FindTracesParams.Type
export const FindTracesParams = Schema.Struct({
	app: Schema.OptionFromOptionalKey(AppFilter),
	cursor: Schema.OptionFromOptionalKey(TraceCursor),
	errors: pipe(
		Schema.Boolean,
		Schema.withDecodingDefaultTypeKey(Effect.succeed(false)),
		Schema.annotateEncoded({description: 'Only traces with a failed span; denied sign-ins are not failures.'})
	),
	limit: pipe(
		Schema.Int,
		Schema.check(Schema.isBetween({maximum: 50, minimum: 1})),
		Schema.withDecodingDefaultTypeKey(Effect.succeed(10)),
		Schema.annotateEncoded({description: 'Rows to return, 1 to 50; default 10.'})
	),
	operation: pipe(
		Schema.String,
		Schema.OptionFromOptionalKey,
		Schema.annotateEncoded({description: 'Root operation name, exactly as list_operations shows it.'})
	),
	since: Since,
	sort: pipe(
		Schema.Literals(['recent', 'slowest']),
		Schema.withDecodingDefaultTypeKey(Effect.succeed('recent' as const)),
		Schema.annotateEncoded({description: "'recent' newest first, 'slowest' longest first; default 'recent'."})
	),
	span: pipe(
		Schema.String,
		Schema.OptionFromOptionalKey,
		Schema.annotateEncoded({description: 'Only traces holding a span with this exact name.'})
	),
	text: pipe(
		Schema.String,
		Schema.OptionFromOptionalKey,
		Schema.annotateEncoded({description: 'Case-insensitive text in span names, attributes, errors or log lines.'})
	)
})

export type ReadTraceParams = typeof ReadTraceParams.Type
export const ReadTraceParams = Schema.Struct({
	id: Schema.annotateEncoded<typeof TraceId>({
		description: 'The full 32-hex trace id from list_operations or search_traces.'
	})(TraceId),
	limit: pipe(
		Schema.Int,
		Schema.check(Schema.isBetween({maximum: 1000, minimum: 1})),
		Schema.withDecodingDefaultTypeKey(Effect.succeed(100)),
		Schema.annotateEncoded({description: 'Spans to return, 1 to 1000; default 100.'})
	)
})

export type LogCursor = typeof LogCursor.Type
export const LogCursor = Schema.Struct(Struct.pick(Log.fields, ['id', 'time']))

// One page of search_logs as the database answers it.
export type LogQuery = typeof LogQuery.Type
export const LogQuery = Schema.Struct({
	...Struct.pick(LatencyQuery.fields, ['cutoff', 'services']),
	cursor: Schema.OptionFromNullOr(LogCursor),
	limit: Schema.Int,
	minimum: Schema.OptionFromNullOr(Log.fields.severity),
	text: Schema.OptionFromNullOr(Schema.String),
	traceId: Schema.OptionFromNullOr(TraceId)
})

export type SearchLogsParams = typeof SearchLogsParams.Type
export const SearchLogsParams = Schema.Struct({
	app: Schema.OptionFromOptionalKey(AppFilter),
	cursor: Schema.OptionFromOptionalKey(LogCursor),
	level: pipe(
		Schema.Literals(['error', 'warn', 'info', 'debug']),
		Schema.OptionFromOptionalKey,
		Schema.annotateEncoded({description: 'Minimum severity; omit for every level.'})
	),
	limit: pipe(
		Schema.Int,
		Schema.check(Schema.isBetween({maximum: 100, minimum: 1})),
		Schema.withDecodingDefaultTypeKey(Effect.succeed(20)),
		Schema.annotateEncoded({description: 'Rows to return, 1 to 100; default 20.'})
	),
	since: Since,
	text: pipe(
		Schema.String,
		Schema.OptionFromOptionalKey,
		Schema.annotateEncoded({description: 'Case-insensitive text in the message or its attributes.'})
	),
	trace: pipe(
		TraceId,
		Schema.OptionFromOptionalKey,
		Schema.annotateEncoded({description: 'Only logs correlated with this 32-hex trace id.'})
	)
})

export type MeasureLatencyParams = typeof MeasureLatencyParams.Type
export const MeasureLatencyParams = Schema.Struct({
	app: Schema.OptionFromOptionalKey(AppFilter),
	name: Schema.annotateEncoded<Schema.NonEmptyString>({
		description: 'Exact span name, such as "notes.search" or "GET /api/notes".'
	})(Schema.NonEmptyString),
	since: Since
})

export type OperationRow = typeof OperationRow.Type
export const OperationRow = Schema.Struct({
	failedTraces: Schema.OptionFromOptionalKey(
		Schema.Int.annotate({description: 'Runs whose trace holds any failed span, not only a failed root.'})
	),
	failure: Schema.OptionFromOptionalKey(
		Schema.Struct({error: Schema.OptionFromOptionalKey(Schema.String), span: Schema.String, trace: TraceId})
	),
	name: Schema.String,
	p50Ms: DurationFromFiniteMillis,
	p95Ms: DurationFromFiniteMillis,
	runs: Schema.Int,
	side: Schema.OptionFromOptionalKey(Side),
	slowest: TraceId
})

export type OperationsAnswer = typeof OperationsAnswer.Type
export const OperationsAnswer = Schema.Struct({
	apps: Schema.Array(Schema.Struct({app: AppName, operations: Schema.Array(OperationRow)}))
})

export type TraceRow = typeof TraceRow.Type
export const TraceRow = Schema.Struct({
	app: AppName,
	at: Schema.DateTimeUtcFromString.annotate({description: 'ISO-8601 trace start timestamp.'}),
	failure: Schema.OptionFromOptionalKey(
		Schema.String.annotate({description: 'Failing span name and error message, not a span id.'})
	),
	id: TraceId,
	ms: DurationFromFiniteMillis.annotate({description: 'Trace duration in milliseconds.'}),
	operation: Schema.String,
	server: Schema.OptionFromOptionalKey(McpServerName),
	side: Schema.OptionFromOptionalKey(Side),
	spans: Schema.Int,
	tool: Schema.OptionFromOptionalKey(McpToolName)
})

export type TracesAnswer = typeof TracesAnswer.Type
export const TracesAnswer = Schema.Struct({
	nextCursor: Schema.OptionFromOptionalKey(TraceCursor),
	traces: Schema.Array(TraceRow)
})

export type ReadSpan = typeof ReadSpan.Type
export const ReadSpan = Schema.Struct({
	app: AppName,
	at: DurationFromFiniteMillis.annotate({description: 'Start offset from the trace start in milliseconds.'}),
	attrs: Schema.OptionFromOptionalKey(ToolAttributes),
	denied: Schema.OptionFromOptionalKey(Schema.Boolean),
	error: Schema.OptionFromOptionalKey(Schema.String),
	id: SpanId,
	logs: Schema.OptionFromOptionalKey(Schema.Array(CompactLog)),
	ms: DurationFromFiniteMillis.annotate({description: 'Span duration in milliseconds.'}),
	name: Schema.String,
	parent: Schema.OptionFromOptionalKey(SpanId),
	side: Schema.OptionFromOptionalKey(Side),
	trace: Schema.OptionFromOptionalKey(
		TraceId.annotate({description: 'The linked trace this span belongs to, when not the trace read.'})
	)
})

export type ReadTraceAnswer = typeof ReadTraceAnswer.Type
export const ReadTraceAnswer = Schema.Struct({
	at: Schema.DateTimeUtcFromString.annotate({description: 'ISO-8601 trace start timestamp.'}),
	failure: Schema.OptionFromOptionalKey(SpanId.annotate({description: 'Failing span id; locate it in spans.'})),
	id: TraceId,
	logs: Schema.OptionFromOptionalKey(Schema.Array(CompactLog)),
	ms: DurationFromFiniteMillis,
	omitted: Schema.OptionFromOptionalKey(Schema.Int),
	spans: Schema.Array(ReadSpan)
})

export type LogRow = typeof LogRow.Type
export const LogRow = Schema.Struct({
	app: AppName,
	at: Schema.DateTimeUtcFromString,
	attrs: Schema.OptionFromOptionalKey(ToolAttributes),
	id: LogId,
	level: LogLevel,
	message: Schema.String,
	side: Schema.OptionFromOptionalKey(Side),
	span: Schema.OptionFromOptionalKey(SpanId),
	trace: Schema.OptionFromOptionalKey(TraceId)
})

export type LogsAnswer = typeof LogsAnswer.Type
export const LogsAnswer = Schema.Struct({
	logs: Schema.Array(LogRow),
	nextCursor: Schema.OptionFromOptionalKey(LogCursor)
})

export type LatencyAnswer = typeof LatencyAnswer.Type
export const LatencyAnswer = Schema.Struct({
	count: Schema.Int,
	failedSpans: Schema.Int.annotate({description: 'Samples of this span name that failed themselves.'}),
	maxMs: DurationFromFiniteMillis,
	p50Ms: DurationFromFiniteMillis,
	p95Ms: DurationFromFiniteMillis
})
