import {Array, DateTime, Duration, Effect, Function, Option, Schema, SchemaGetter, Struct, pipe} from 'effect'

import {Model} from 'effect/schema'

import {
	DateTimeUtcFromFiniteMillis,
	DurationFromFiniteMillis,
	TimeFrame,
	timeFrameDuration
} from '@deslop/runtime/shared/time'

export class TelemetryError extends Schema.TaggedError<TelemetryError>()('TelemetryError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type TraceId = typeof TraceId.Type
export const TraceId = pipe(
	Schema.String,
	Schema.check(Schema.isPattern(/^[a-fA-F0-9]{32}$/u)),
	Schema.brand('TraceId')
)

export type SpanId = typeof SpanId.Type
export const SpanId = pipe(Schema.String, Schema.check(Schema.isPattern(/^[a-fA-F0-9]{16}$/u)), Schema.brand('SpanId'))

export type LogId = typeof LogId.Type
// The first six bytes of a record's digest, exact in a number and usable as its row id.
export const LogId = pipe(Schema.Int, Schema.brand('ScopeLogId'))

export type ServiceName = typeof ServiceName.Type
export const ServiceName = pipe(Schema.String, Schema.brand('ScopeServiceName'))

export type AppName = typeof AppName.Type
export const AppName = pipe(Schema.String, Schema.brand('ScopeAppName'))

export type ReleaseVersion = typeof ReleaseVersion.Type
export const ReleaseVersion = pipe(Schema.String, Schema.brand('ScopeReleaseVersion'))

type McpServerName = typeof McpServerName.Type
export const McpServerName = pipe(Schema.String, Schema.brand('ScopeMcpServerName'))

type McpToolName = typeof McpToolName.Type
export const McpToolName = pipe(Schema.String, Schema.brand('ScopeMcpToolName'))

export type Nano = typeof Nano.Type
// OTLP's decimal epoch nanoseconds stay exact until ingestion projects a stored instant or duration.
export const Nano = pipe(
	Schema.String.check(Schema.isPattern(/^\d{1,20}$/u)),
	Schema.decodeTo(Schema.Duration.check(Schema.makeFilter(Duration.isFinite, {expected: 'finite epoch nanoseconds'})), {
		decode: SchemaGetter.transform(value => Duration.nanos(BigInt(value))),
		encode: SchemaGetter.transform(value => Duration.toNanosUnsafe(value).toString())
	})
)

type SpanIdFromEmpty = typeof SpanIdFromEmpty.Type
const SpanIdFromEmpty = pipe(
	Schema.OptionFromOptionalKey(Schema.Union([SpanId, Schema.Literal('')])),
	Schema.decodeTo(Schema.Option(Schema.toType(SpanId)), {
		decode: SchemaGetter.transform(value => Option.filter(value, (id): id is SpanId => id !== '')),
		encode: SchemaGetter.transform(Function.identity)
	})
)

type TraceIdFromEmpty = typeof TraceIdFromEmpty.Type
const TraceIdFromEmpty = pipe(
	Schema.OptionFromOptionalKey(Schema.Union([TraceId, Schema.Literal('')])),
	Schema.decodeTo(Schema.Option(Schema.toType(TraceId)), {
		decode: SchemaGetter.transform(value => Option.filter(value, (id): id is TraceId => id !== '')),
		encode: SchemaGetter.transform(Function.identity)
	})
)

export type Attribute = typeof Attribute.Type
export const Attribute = Schema.Struct({key: Schema.String, value: Schema.JsonObject})

export type Resource = typeof Resource.Type
export const Resource = Schema.Struct({attributes: Schema.OptionFromOptionalKey(Schema.Array(Attribute))}).annotate({
	parseOptions: {onExcessProperty: 'preserve'}
})

type SpanDetails = typeof SpanDetails.Type
const SpanDetails = Schema.Struct({
	attributes: Schema.OptionFromOptionalKey(Schema.Array(Attribute)),
	events: Schema.OptionFromOptionalKey(
		Schema.Array(
			Schema.Struct({
				attributes: Schema.OptionFromOptionalKey(Schema.Array(Attribute)),
				name: Schema.String,
				timeUnixNano: Nano
			}).annotate({parseOptions: {onExcessProperty: 'preserve'}})
		)
	),
	links: Schema.OptionFromOptionalKey(
		Schema.Array(
			Schema.Struct({
				attributes: Schema.OptionFromOptionalKey(Schema.Array(Attribute)),
				spanId: SpanId,
				traceId: TraceId
			}).annotate({parseOptions: {onExcessProperty: 'preserve'}})
		)
	)
})

// A span as OTLP exports it; Scope reads it once on arrival into a `Span` row.
export type ExportedSpan = typeof ExportedSpan.Type
export const ExportedSpan = Schema.Struct({
	...SpanDetails.fields,
	endTimeUnixNano: Schema.OptionFromOptionalKey(Nano),
	kind: Schema.OptionFromOptionalKey(Schema.Json),
	name: Schema.OptionFromOptionalKey(Schema.String),
	parentSpanId: SpanIdFromEmpty,
	spanId: SpanId,
	startTimeUnixNano: Nano,
	status: Schema.OptionFromOptionalKey(
		Schema.Struct({
			code: Schema.OptionFromOptionalKey(Schema.Int),
			message: Schema.OptionFromOptionalKey(Schema.Json)
		}).annotate({parseOptions: {onExcessProperty: 'preserve'}})
	),
	traceId: TraceId
}).annotate({parseOptions: {onExcessProperty: 'preserve'}})

export type ExportedLog = typeof ExportedLog.Type
export const ExportedLog = Schema.Struct({
	attributes: Schema.OptionFromOptionalKey(Schema.Array(Attribute)),
	body: Schema.OptionFromOptionalKey(Schema.JsonObject),
	observedTimeUnixNano: Schema.OptionFromOptionalKey(Nano),
	severityNumber: Schema.OptionFromOptionalKey(Schema.Int),
	severityText: Schema.OptionFromOptionalKey(Schema.String),
	spanId: SpanIdFromEmpty,
	timeUnixNano: Nano,
	traceId: TraceIdFromEmpty
}).annotate({parseOptions: {onExcessProperty: 'preserve'}})

export type TracesRequest = typeof TracesRequest.Type
export const TracesRequest = Schema.Struct({
	resourceSpans: Schema.OptionFromOptionalKey(
		Schema.Array(
			Schema.Struct({
				resource: Schema.OptionFromOptionalKey(Resource),
				schemaUrl: Schema.optionalKey(Schema.String),
				scopeSpans: Schema.OptionFromOptionalKey(
					Schema.Array(
						Schema.Struct({
							schemaUrl: Schema.optionalKey(Schema.String),
							scope: Schema.optionalKey(Resource),
							spans: Schema.OptionFromOptionalKey(Schema.Array(ExportedSpan))
						}).annotate({parseOptions: {onExcessProperty: 'preserve'}})
					)
				)
			}).annotate({parseOptions: {onExcessProperty: 'preserve'}})
		)
	)
})

export type LogsRequest = typeof LogsRequest.Type
export const LogsRequest = Schema.Struct({
	resourceLogs: Schema.OptionFromOptionalKey(
		Schema.Array(
			Schema.Struct({
				resource: Schema.OptionFromOptionalKey(Resource),
				schemaUrl: Schema.optionalKey(Schema.String),
				scopeLogs: Schema.OptionFromOptionalKey(
					Schema.Array(
						Schema.Struct({
							logRecords: Schema.OptionFromOptionalKey(Schema.Array(ExportedLog)),
							schemaUrl: Schema.optionalKey(Schema.String),
							scope: Schema.optionalKey(Resource)
						}).annotate({parseOptions: {onExcessProperty: 'preserve'}})
					)
				)
			}).annotate({parseOptions: {onExcessProperty: 'preserve'}})
		)
	)
})

// The oldest start a frame holds, in epoch milliseconds.
export function rangeStart(range: TimeFrame, now: DateTime.Utc) {
	return DateTime.subtractDuration(now, timeFrameDuration(range))
}

export type Runtime = typeof Runtime.Type
export const Runtime = Schema.Literals(['web', 'mobile', 'server', 'ci', 'unknown'])

// The side the tools name instead of a package suffix; a resource without one falls back to its service name.
export type Side = typeof Side.Type
export const Side = Schema.Literals(['web', 'mobile', 'server', 'ci'])

// An attribute's one value: a string, number or boolean as OTLP wrapped it, unwrapped; anything else stays as sent.
export type Attributes = typeof Attributes.Type
export const Attributes = Schema.Record(Schema.String, Schema.Json)

// The resource fields every span and log carries: who sent it, from which run of which release.
const SENDER = {
	// When the sending process started, which tells its runs apart; none when it does not say.
	run: Schema.OptionFromNullOr(Schema.DateTimeUtcFromMillis),
	runtime: Runtime,
	service: ServiceName,
	// `service.version` as sent; none for a local build.
	version: Schema.OptionFromNullOr(ReleaseVersion)
}

// One span, read from OTLP once on arrival; queries answer it with hex ids, its sender and its whole attributes.
export type Span = typeof Span.Type
export const Span = Schema.Struct({
	...SENDER,
	attributes: Schema.fromJsonString(Attributes),
	// None while the span is still open, as a running CI workflow is.
	duration: Schema.OptionFromNullOr(Schema.DurationFromMillis),
	// The status message of a failed or denied span.
	error: Schema.OptionFromNullOr(Schema.String),
	// The message of its first exception, which a failure's diagnosis prefers.
	exception: Schema.OptionFromNullOr(Schema.String),
	name: Schema.String,
	parentSpanId: Schema.OptionFromNullOr(SpanId),
	spanId: SpanId,
	// Fractional epoch milliseconds, retained by the public DateTime epoch mapping operation.
	start: DateTimeUtcFromFiniteMillis,
	// A denied span failed only on a sign-in it lacked: no count, dot or error filter includes it.
	status: Schema.Literals(['ok', 'failed', 'denied']),
	traceId: TraceId
})

// A span's link into another trace: the work it started reads as part of the trace that linked it.
export type SpanLink = typeof SpanLink.Type
export const SpanLink = Schema.Struct({linkedSpanId: SpanId, linkedTraceId: TraceId, spanId: SpanId, traceId: TraceId})

// One log record; the identity of one that carries no id of its own is the digest of what it carries.
export type Log = typeof Log.Type
export const Log = Schema.Struct({
	...SENDER,
	attributes: Schema.fromJsonString(Attributes),
	id: LogId,
	message: Schema.String,
	// When its export arrived; a log that names no stored trace starts one then.
	receivedAt: Schema.DateTimeUtcFromMillis,
	// OTLP's severity number: 17 and above is an error.
	severity: Schema.Int,
	spanId: Schema.OptionFromNullOr(SpanId),
	time: DateTimeUtcFromFiniteMillis,
	traceId: Schema.OptionFromNullOr(TraceId)
})

// What every list reads of a trace, judged again whenever one of its spans arrives; the sender, name and label are its root's.
export type Trace = typeof Trace.Type
export const Trace = Schema.Struct({
	...SENDER,
	// Where the failure broke: the earliest failed span without a failed child.
	broken: Schema.OptionFromNullOr(SpanId),
	duration: Schema.DurationFromMillis,
	id: TraceId,
	// The root's `trace.label`, which names the run a row stands for.
	label: Schema.OptionFromNullOr(Schema.String),
	name: Schema.String,
	// When its first span or log arrived; retention drops the whole trace from then.
	receivedAt: Schema.DateTimeUtcFromMillis,
	// The span it starts from: one whose parent the trace doesn't hold, the earliest if a skewed clock leaves several.
	root: SpanId,
	// Whether a span without a parent has arrived; children export first, so until then the trace may still be growing.
	rooted: Schema.Boolean,
	spans: Schema.Int,
	start: DateTimeUtcFromFiniteMillis,
	// A subscription or a machine's timer: its lifetime is a wait, not an operation's latency.
	waits: Schema.Boolean
})

// A trace as the operations list counts it: its root's name and sender, and whether it broke.
export type SettledTrace = typeof SettledTrace.Type
export const SettledTrace = Schema.Struct({
	...Struct.pick(Trace.fields, ['duration', 'id', 'name', 'runtime', 'service', 'start']),
	failed: Schema.BooleanFromBit
})

// App tabs count every retained settled trace, independently of the operations' time frame.
export type RetainedService = typeof RetainedService.Type
export const RetainedService = Schema.Struct({
	ci: Schema.BooleanFromBit,
	count: Schema.Int,
	failures: Schema.Int,
	service: Span.fields.service
})

// What a trace's row shows beyond its numbers: its label, and the name and messages of the span where it broke.
export type TraceDetail = typeof TraceDetail.Type
export const TraceDetail = Schema.Struct({
	...Struct.pick(Trace.fields, ['id', 'label']),
	...Struct.pick(Span.fields, ['error', 'exception']),
	broken: Schema.OptionFromNullOr(Span.fields.name)
})

// A trace as search_traces answers it, with its span count and the MCP relay it went through.
export type FoundTrace = typeof FoundTrace.Type
export const FoundTrace = Schema.Struct({
	...Struct.omit(SettledTrace.fields, ['failed']),
	...Struct.omit(TraceDetail.fields, ['label']),
	relay: Schema.OptionFromNullOr(Span.fields.attributes),
	spans: Schema.Int
})

// Each service's latest run: how much it sent, when it last did, and what it said it was.
export type ServiceRun = typeof ServiceRun.Type
export const ServiceRun = Schema.Struct({
	...Struct.pick(Span.fields, ['run', 'runtime', 'service', 'version']),
	entries: Schema.Int,
	lastEvent: DateTimeUtcFromFiniteMillis
})

export type LatencyQuery = typeof LatencyQuery.Type
export const LatencyQuery = Schema.Struct({
	cutoff: DateTimeUtcFromFiniteMillis,
	name: Span.fields.name,
	// The services of the app asked for; none for every app.
	services: Schema.OptionFromNullOr(Schema.Array(Span.fields.service))
})

export type Rejection = typeof Rejection.Type
export const Rejection = Schema.Struct({
	count: Schema.Natural,
	credential: Schema.Literals(['authorization', 'cookie', 'none']),
	lastAt: DateTimeUtcFromFiniteMillis,
	route: Schema.Literals(['/v1/traces', '/v1/logs']),
	status: Schema.Int
})

export type SpanFacts = typeof SpanFacts.Type
export const SpanFacts = Schema.Struct(
	Struct.pick(Span.fields, [
		'attributes',
		'duration',
		'name',
		'parentSpanId',
		'run',
		'runtime',
		'service',
		'spanId',
		'start',
		'status',
		'traceId',
		'version'
	])
)
export type SpanFailure = typeof SpanFailure.Type
export const SpanFailure = Schema.Struct(Struct.pick(Span.fields, ['error', 'exception']))
export type LogFacts = typeof LogFacts.Type
export const LogFacts = Schema.Struct(Struct.pick(Log.fields, ['message', 'severity', 'time']))
export type RejectedExport = typeof RejectedExport.Type
export const RejectedExport = Schema.Struct(Struct.pick(Rejection.fields, ['credential', 'route', 'status']))

export type OperationTrace = typeof OperationTrace.Type
export const OperationTrace = Schema.Struct({
	...Struct.pick(Trace.fields, ['duration', 'id', 'start']),
	failure: Schema.OptionFromOptionalKey(
		Schema.Struct({error: Schema.OptionFromOptionalKey(Schema.String), span: Span.fields.name})
	),
	label: Schema.OptionFromOptionalKey(Schema.String)
})

// One operation as one side of the app started it: the same name from its web client and its server are two.
export type Operation = typeof Operation.Type
export const Operation = Schema.Struct({
	count: Schema.Int,
	failures: Schema.Int,
	name: Schema.String,
	p50Ms: DurationFromFiniteMillis,
	p95Ms: DurationFromFiniteMillis,
	runtime: Runtime,
	// The slowest first; an operation exists because a trace started it, so it keeps at least that one.
	traces: Schema.NonEmptyArray(OperationTrace)
})

export type Overview = typeof Overview.Type
export const Overview = Schema.Struct({
	apps: Schema.Array(
		Schema.Struct({
			ci: Schema.OptionFromOptionalKey(Schema.Boolean),
			name: AppName,
			operations: Schema.Array(Operation)
		})
	)
})

// A span as the trace view draws it: its row, where it sits in the tree and the timeline, and its logs. A linked trace's root hangs under the span it links to.
type TraceSpan = typeof TraceSpan.Type
const TraceSpan = Schema.Struct({
	...Span.fields,
	depth: Schema.Natural,
	durationMs: DurationFromFiniteMillis,
	logs: Schema.Array(Log),
	offsetMs: DurationFromFiniteMillis
})

// A trace and every trace a span link joins to it, as one tree in start order.
export type TraceTree = typeof TraceTree.Type
export const TraceTree = Schema.Struct({
	durationMs: DurationFromFiniteMillis,
	failureSpanId: Schema.OptionFromOptionalKey(SpanId),
	id: TraceId,
	// Logs of the trace that name no span it holds.
	logs: Schema.Array(Log),
	spans: Schema.Array(TraceSpan)
})

type ATTRIBUTE_VALUE = typeof ATTRIBUTE_VALUE.Type
const ATTRIBUTE_VALUE = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean])
// The tools' attributes: primitive values only, without what only repeats the row.
export type ToolAttributes = typeof ToolAttributes.Type
export const ToolAttributes = Schema.Record(Schema.String, ATTRIBUTE_VALUE)

export type LogLevel = typeof LogLevel.Type
export const LogLevel = Schema.Literals(['debug', 'error', 'info', 'trace', 'warn'])

export type CompactLog = typeof CompactLog.Type
export const CompactLog = Schema.Struct({
	at: Schema.DateTimeUtcFromString.annotate({description: 'ISO-8601 log timestamp.'}),
	level: LogLevel,
	message: Schema.String
})

type App = typeof App.Type
// The tools' inputs: every field optional except where a tool cannot answer without it.
const App = Schema.annotateEncoded<typeof AppName>({
	description: 'App name as list_operations shows it, such as "trips"; omit for every app.'
})(AppName)

export const Since = pipe(
	TimeFrame,
	Schema.withDecodingDefaultTypeKey(Effect.succeed('1h' as const)),
	Schema.annotateEncoded({description: `Time window: ${Array.join(TimeFrame.literals, ', ')}; default '1h'.`})
)

export type ListOperationsParams = typeof ListOperationsParams.Type
export const ListOperationsParams = Schema.Struct({app: Schema.OptionFromOptionalKey(App), since: Since})

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
	app: Schema.OptionFromOptionalKey(App),
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
	app: Schema.OptionFromOptionalKey(App),
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
	app: Schema.OptionFromOptionalKey(App),
	name: Schema.annotateEncoded<Schema.NonEmptyString>({
		description: 'Exact span name, such as "notes.search" or "GET /api/notes".'
	})(Schema.NonEmptyString),
	since: Since
})

export type OperationRow = typeof OperationRow.Type
export const OperationRow = Schema.Struct({
	failure: Schema.OptionFromOptionalKey(
		Schema.Struct({error: Schema.OptionFromOptionalKey(Schema.String), span: Schema.String, trace: TraceId})
	),
	failures: Schema.OptionFromOptionalKey(Schema.Int),
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
	total: Schema.Int,
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
	side: Schema.OptionFromOptionalKey(Side)
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
	level: LogLevel,
	message: Schema.String,
	side: Schema.OptionFromOptionalKey(Side),
	span: Schema.OptionFromOptionalKey(SpanId),
	trace: Schema.OptionFromOptionalKey(TraceId)
})

export type LogsAnswer = typeof LogsAnswer.Type
export const LogsAnswer = Schema.Struct({
	logs: Schema.Array(LogRow),
	nextCursor: Schema.OptionFromOptionalKey(LogCursor),
	total: Schema.Int
})

export type LatencyAnswer = typeof LatencyAnswer.Type
export const LatencyAnswer = Schema.Struct({
	count: Schema.Int,
	failures: Schema.Int,
	maxMs: DurationFromFiniteMillis,
	p50Ms: DurationFromFiniteMillis,
	p95Ms: DurationFromFiniteMillis
})

export type IngestionService = typeof IngestionService.Type
export const IngestionService = Schema.Struct({
	app: AppName,
	entries: Schema.Int,
	lastEvent: Schema.DateTimeUtcFromString,
	release: Schema.OptionFromOptionalKey(ReleaseVersion),
	runStarted: Schema.Option(Schema.DateTimeUtc),
	side: Schema.OptionFromOptionalKey(Side)
})

export type IngestionRejection = typeof IngestionRejection.Type
export const IngestionRejection = Schema.Struct({
	count: Schema.Int,
	credential: Schema.Literals(['authorization', 'cookie', 'none']),
	lastAt: Schema.DateTimeUtcFromString,
	route: Schema.Literals(['/v1/traces', '/v1/logs']),
	status: Schema.Int
})

export type IngestionAnswer = typeof IngestionAnswer.Type
export const IngestionAnswer = Schema.Struct({
	rejections: Schema.OptionFromOptionalKey(Schema.Array(IngestionRejection)),
	services: Schema.Array(IngestionService)
})

// The stored tables: hex ids become blobs, each sender and SQL statement is stored once, and rows name them by id.

// One sender; UNIQUE keeps NULLs apart, so its index compares an absent run or release as a marker no real one takes.
export class StoredResource extends Model.Class<StoredResource>('StoredResource')({id: Schema.Int, ...SENDER}) {
	static readonly table = 'resources'
}

// One `db.query.text`, which spans name instead of repeating it.
export class StoredStatement extends Model.Class<StoredStatement>('StoredStatement')({
	id: Schema.Int,
	text: Schema.String
}) {
	static readonly table = 'statements'
}

// A trace and what its lists show of its root, so no list reads its spans; ids rise in arrival order, so retention drops a range of them.
export class StoredTrace extends Model.Class<StoredTrace>('StoredTrace')({
	broken: Model.FieldOption(Schema.Uint8Array),
	duration: Schema.DurationFromMillis,
	id: Schema.Int,
	label: Model.FieldOption(Schema.String),
	name: Schema.String,
	receivedAt: Schema.DateTimeUtcFromMillis,
	resource: Schema.Int,
	rooted: Model.BooleanSqlite,
	spans: Schema.Int,
	start: DateTimeUtcFromFiniteMillis,
	// None for the logs of one export that name no trace.
	traceId: Model.FieldOption(Schema.Uint8Array),
	waits: Model.BooleanSqlite
}) {
	static readonly table = 'traces'
}

// A span with constant attribute keys and its SQL statement stripped from its attributes; its row id keys its search entry.
export class StoredSpan extends Model.Class<StoredSpan>('StoredSpan')({
	attributes: Model.JsonFromString(Attributes),
	duration: Model.FieldOption(Schema.DurationFromMillis),
	error: Model.FieldOption(Schema.String),
	exception: Model.FieldOption(Schema.String),
	id: Schema.Int,
	// 0 is work, whose duration is latency; 1 a stream's lifetime, 2 a machine's timer, 3 a request no route answered.
	kind: Schema.Literals([0, 1, 2, 3]),
	name: Schema.String,
	parent: Model.FieldOption(Schema.Uint8Array),
	resource: Schema.Int,
	span: Schema.Uint8Array,
	start: DateTimeUtcFromFiniteMillis,
	statement: Model.FieldOption(Schema.Int),
	// 0 ok, 1 failed, 2 denied.
	status: Schema.Literals([0, 1, 2]),
	trace: Schema.Int
}) {
	static readonly table = 'spans'
}

// A log under the trace it names, or under its export's own trace when it names none.
export class StoredLog extends Model.Class<StoredLog>('StoredLog')({
	attributes: Model.JsonFromString(Attributes),
	id: LogId,
	message: Schema.String,
	resource: Schema.Int,
	severity: Schema.Int,
	span: Model.FieldOption(Schema.Uint8Array),
	time: DateTimeUtcFromFiniteMillis,
	trace: Schema.Int
}) {
	static readonly table = 'logs'
}

// A link names the trace it points to by id, since that trace may not have arrived.
export class StoredSpanLink extends Model.Class<StoredSpanLink>('StoredSpanLink')({
	linkedSpan: Schema.Uint8Array,
	linkedTrace: Schema.Uint8Array,
	span: Schema.Uint8Array,
	trace: Schema.Int
}) {
	static readonly table = 'span_links'
}
