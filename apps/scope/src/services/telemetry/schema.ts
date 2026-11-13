import {Effect, Schema, Struct, pipe} from 'effect'

import {Model} from 'effect/schema'

const RANGE_MS: Record<Range, number> = {'1h': 3_600_000, '3d': 259_200_000, '10m': 600_000, '24h': 86_400_000}

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

export type Nano = typeof Nano.Type
export const Nano = Schema.String.check(Schema.isPattern(/^\d{1,20}$/u))

export type Attribute = typeof Attribute.Type
export const Attribute = Schema.Struct({key: Schema.String, value: Schema.JsonObject})

export type Resource = typeof Resource.Type
export const Resource = Schema.StructWithRest(
	Schema.Struct({attributes: Schema.optionalKey(Schema.Array(Attribute))}),
	[Schema.JsonObject]
)

type SpanDetails = typeof SpanDetails.Type
const SpanDetails = Schema.Struct({
	attributes: Schema.optionalKey(Schema.Array(Attribute)),
	events: Schema.optionalKey(
		Schema.Array(
			Schema.StructWithRest(
				Schema.Struct({
					attributes: Schema.optionalKey(Schema.Array(Attribute)),
					name: Schema.String,
					timeUnixNano: Nano
				}),
				[Schema.JsonObject]
			)
		)
	),
	links: Schema.optionalKey(
		Schema.Array(
			Schema.StructWithRest(
				Schema.Struct({attributes: Schema.optionalKey(Schema.Array(Attribute)), spanId: SpanId, traceId: TraceId}),
				[Schema.JsonObject]
			)
		)
	)
})

// A span as OTLP exports it; Scope reads it once on arrival into a `Span` row.
export type ExportedSpan = typeof ExportedSpan.Type
const ExportedSpan = Schema.StructWithRest(
	Schema.Struct({
		...SpanDetails.fields,
		endTimeUnixNano: Schema.optionalKey(Nano),
		name: Schema.optionalKey(Schema.String),
		parentSpanId: Schema.optionalKey(Schema.Union([SpanId, Schema.Literal('')])),
		spanId: SpanId,
		startTimeUnixNano: Nano,
		status: Schema.optionalKey(
			Schema.StructWithRest(Schema.Struct({code: Schema.optionalKey(Schema.Int)}), [Schema.JsonObject])
		),
		traceId: TraceId
	}),
	[Schema.JsonObject]
)

type ExportedLog = typeof ExportedLog.Type
const ExportedLog = Schema.StructWithRest(
	Schema.Struct({
		attributes: Schema.optionalKey(Schema.Array(Attribute)),
		body: Schema.optionalKey(Schema.JsonObject),
		observedTimeUnixNano: Schema.optionalKey(Nano),
		severityNumber: Schema.optionalKey(Schema.Int),
		severityText: Schema.optionalKey(Schema.String),
		spanId: Schema.optionalKey(Schema.Union([SpanId, Schema.Literal('')])),
		timeUnixNano: Nano,
		traceId: Schema.optionalKey(Schema.Union([TraceId, Schema.Literal('')]))
	}),
	[Schema.JsonObject]
)

export type TracesRequest = typeof TracesRequest.Type
export const TracesRequest = Schema.Struct({
	resourceSpans: Schema.optionalKey(
		Schema.Array(
			Schema.StructWithRest(
				Schema.Struct({
					resource: Schema.optionalKey(Resource),
					schemaUrl: Schema.optionalKey(Schema.String),
					scopeSpans: Schema.optionalKey(
						Schema.Array(
							Schema.StructWithRest(
								Schema.Struct({
									schemaUrl: Schema.optionalKey(Schema.String),
									scope: Schema.optionalKey(Resource),
									spans: Schema.optionalKey(Schema.Array(ExportedSpan))
								}),
								[Schema.JsonObject]
							)
						)
					)
				}),
				[Schema.JsonObject]
			)
		)
	)
})

export type LogsRequest = typeof LogsRequest.Type
export const LogsRequest = Schema.Struct({
	resourceLogs: Schema.optionalKey(
		Schema.Array(
			Schema.StructWithRest(
				Schema.Struct({
					resource: Schema.optionalKey(Resource),
					schemaUrl: Schema.optionalKey(Schema.String),
					scopeLogs: Schema.optionalKey(
						Schema.Array(
							Schema.StructWithRest(
								Schema.Struct({
									logRecords: Schema.optionalKey(Schema.Array(ExportedLog)),
									schemaUrl: Schema.optionalKey(Schema.String),
									scope: Schema.optionalKey(Resource)
								}),
								[Schema.JsonObject]
							)
						)
					)
				}),
				[Schema.JsonObject]
			)
		)
	)
})

export type Range = typeof Range.Type
// The page's time frame and the tools' window; three days is what the store keeps.
export const Range = Schema.Literals(['10m', '1h', '24h', '3d'])

export function rangeMs(range: Range) {
	return RANGE_MS[range]
}

// The oldest start a frame holds, in epoch milliseconds.
export function rangeStart(range: Range, now: number) {
	return now - rangeMs(range)
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
	run: Model.FieldOption(Schema.DateTimeUtcFromMillis),
	runtime: Runtime,
	service: Schema.String,
	// `service.version` as sent; none for a local build.
	version: Model.FieldOption(Schema.String)
}

// One span, read from OTLP once on arrival: the page and the tools read these columns.
export class Span extends Model.Class<Span>('Span')({
	...SENDER,
	attributes: Model.JsonFromString(Attributes),
	// None while the span is still open, as a running CI workflow is.
	duration: Model.FieldOption(Schema.DurationFromMillis),
	// The status message of a failed or denied span.
	error: Model.FieldOption(Schema.String),
	// The message of its first exception, which a failure's diagnosis prefers.
	exception: Model.FieldOption(Schema.String),
	name: Schema.String,
	parentSpanId: Model.FieldOption(SpanId),
	spanId: SpanId,
	// Epoch milliseconds with the fraction the flame graph needs; a DateTime holds whole milliseconds only.
	start: Schema.Finite,
	// A denied span failed only on a sign-in it lacked: no count, dot or error filter includes it.
	status: Schema.Literals(['ok', 'failed', 'denied']),
	traceId: TraceId
}) {
	static readonly table = 'spans'
}

// A span's link into another trace: the work it started reads as part of the trace that linked it.
export class SpanLink extends Model.Class<SpanLink>('SpanLink')({
	linkedSpanId: SpanId,
	linkedTraceId: TraceId,
	spanId: SpanId,
	traceId: TraceId
}) {
	static readonly table = 'span_links'
}

// One log record; the identity of one that carries no id of its own is the digest of what it carries.
export class Log extends Model.Class<Log>('Log')({
	...SENDER,
	attributes: Model.JsonFromString(Attributes),
	id: Schema.NonEmptyString,
	message: Schema.String,
	receivedAt: Model.DateTimeInsertFromNumber,
	// OTLP's severity number: 17 and above is an error.
	severity: Schema.Int,
	spanId: Model.FieldOption(SpanId),
	time: Schema.Finite,
	traceId: Model.FieldOption(TraceId)
}) {
	static readonly table = 'logs'
}

// What every list reads of a trace, judged again whenever one of its spans arrives.
export class Trace extends Model.Class<Trace>('Trace')({
	// Where the failure broke: the earliest failed span without a failed child.
	broken: Model.FieldOption(SpanId),
	duration: Schema.DurationFromMillis,
	id: TraceId,
	// When its first span arrived; retention drops the whole trace from then.
	receivedAt: Model.DateTimeInsertFromNumber,
	// The span it starts from: one whose parent the trace doesn't hold, the earliest if a skewed clock leaves several.
	root: SpanId,
	// Whether a span without a parent has arrived; children export first, so until then the trace may still be growing.
	rooted: Model.BooleanSqlite,
	start: Schema.Finite,
	// A subscription or a machine's timer: its lifetime is a wait, not an operation's latency.
	waits: Model.BooleanSqlite
}) {
	static readonly table = 'traces'
}

// Each service's newest release seen: what an older one sent may describe a bug since fixed, so it goes.
export class Release extends Model.Class<Release>('Release')({service: Schema.String, version: Schema.String}) {
	static readonly table = 'releases'
}

// A trace as the operations list counts it: its root's name and sender, and whether it broke.
export type SettledTrace = typeof SettledTrace.Type
export const SettledTrace = Schema.Struct({
	...Struct.pick(Trace.fields, ['duration', 'id', 'start']),
	...Struct.pick(Span.fields, ['name', 'runtime', 'service']),
	failed: Schema.BooleanFromBit
})

// What a trace's row shows beyond its numbers: its label, and the name and messages of the span where it broke.
export type TraceDetail = typeof TraceDetail.Type
export const TraceDetail = Schema.Struct({
	...Struct.pick(Trace.fields, ['id']),
	...Struct.pick(Span.fields, ['error', 'exception']),
	broken: Schema.OptionFromNullOr(Span.fields.name),
	label: Schema.OptionFromNullOr(Schema.String)
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
	lastEvent: Schema.Finite
})

// A sender whose release is older than its service's newest.
export type Superseded = typeof Superseded.Type
export const Superseded = Schema.Struct({service: Span.fields.service, version: Schema.String})

export type LatencyQuery = typeof LatencyQuery.Type
export const LatencyQuery = Schema.Struct({
	cutoff: Schema.Finite,
	name: Span.fields.name,
	// The services of the app asked for; none for every app.
	services: Schema.OptionFromNullOr(Schema.Array(Span.fields.service))
})

export type Rejection = typeof Rejection.Type
export const Rejection = Schema.Struct({
	count: Schema.Natural,
	credential: Schema.Literals(['authorization', 'cookie', 'none']),
	lastAt: Schema.Finite,
	route: Schema.Literals(['/v1/traces', '/v1/logs']),
	status: Schema.Int
})

export type OperationTrace = typeof OperationTrace.Type
export const OperationTrace = Schema.Struct({
	...Struct.pick(Trace.json.fields, ['duration', 'id', 'start']),
	failure: Schema.optionalKey(Schema.Struct({error: Schema.optionalKey(Schema.String), span: Span.fields.name})),
	label: Schema.optionalKey(Schema.String)
})

// One operation as one side of the app started it: the same name from its web client and its server are two.
export type Operation = typeof Operation.Type
export const Operation = Schema.Struct({
	count: Schema.Int,
	failures: Schema.Int,
	name: Schema.String,
	p50Ms: Schema.Finite,
	p95Ms: Schema.Finite,
	runtime: Runtime,
	// The slowest first; an operation exists because a trace started it, so it keeps at least that one.
	traces: Schema.NonEmptyArray(OperationTrace)
})

export type Overview = typeof Overview.Type
export const Overview = Schema.Struct({
	apps: Schema.Array(
		Schema.Struct({ci: Schema.optionalKey(Schema.Boolean), name: Schema.String, operations: Schema.Array(Operation)})
	)
})

// A span as the trace view draws it: its row, where it sits in the tree and the timeline, and its logs. A linked trace's root hangs under the span it links to.
type TraceSpan = typeof TraceSpan.Type
const TraceSpan = Schema.Struct({
	...Span.json.fields,
	depth: Schema.Natural,
	durationMs: Schema.Finite,
	logs: Schema.Array(Log.json),
	offsetMs: Schema.Finite
})

// A trace and every trace a span link joins to it, as one tree in start order.
export type TraceTree = typeof TraceTree.Type
export const TraceTree = Schema.Struct({
	durationMs: Schema.Finite,
	failureSpanId: Schema.optionalKey(SpanId),
	id: TraceId,
	// Logs of the trace that name no span it holds.
	logs: Schema.Array(Log.json),
	spans: Schema.Array(TraceSpan)
})

type ATTRIBUTE_VALUE = typeof ATTRIBUTE_VALUE.Type
const ATTRIBUTE_VALUE = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean])
// The tools' attributes: primitive values only, without what only repeats the row.
type ToolAttributes = typeof ToolAttributes.Type
const ToolAttributes = Schema.Record(Schema.String, ATTRIBUTE_VALUE)

export type LogLevel = typeof LogLevel.Type
export const LogLevel = Schema.Literals(['debug', 'error', 'info', 'trace', 'warn'])

export type CompactLog = typeof CompactLog.Type
export const CompactLog = Schema.Struct({
	at: Schema.String.annotate({description: 'ISO-8601 log timestamp.'}),
	level: LogLevel,
	message: Schema.String
})

type App = typeof App.Type
// The tools' inputs: every field optional except where a tool cannot answer without it.
const App = Schema.annotateEncoded<Schema.String>({
	description: 'App name as list_operations shows it, such as "trips"; omit for every app.'
})(Schema.String)

export const Since = pipe(
	Range,
	Schema.withDecodingDefaultTypeKey(Effect.succeed('1h' as const)),
	Schema.annotateEncoded({description: "Time window: '10m', '1h', '24h' or '3d'; default '1h'."})
)

export type ListOperationsParams = typeof ListOperationsParams.Type
export const ListOperationsParams = Schema.Struct({app: Schema.optionalKey(App), since: Since})

export type TraceCursor = typeof TraceCursor.Type
export const TraceCursor = Schema.Struct(Struct.pick(Trace.json.fields, ['duration', 'id', 'start']))

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
	app: Schema.optionalKey(App),
	cursor: Schema.optionalKey(TraceCursor),
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
		Schema.optionalKey,
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
		Schema.optionalKey,
		Schema.annotateEncoded({description: 'Only traces holding a span with this exact name.'})
	),
	text: pipe(
		Schema.String,
		Schema.optionalKey,
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
export const LogCursor = Schema.Struct(Struct.pick(Log.json.fields, ['id', 'time']))

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
	app: Schema.optionalKey(App),
	cursor: Schema.optionalKey(LogCursor),
	level: pipe(
		Schema.Literals(['error', 'warn', 'info', 'debug']),
		Schema.optionalKey,
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
		Schema.optionalKey,
		Schema.annotateEncoded({description: 'Case-insensitive text in the message or its attributes.'})
	),
	trace: pipe(
		TraceId,
		Schema.optionalKey,
		Schema.annotateEncoded({description: 'Only logs correlated with this 32-hex trace id.'})
	)
})

export type MeasureLatencyParams = typeof MeasureLatencyParams.Type
export const MeasureLatencyParams = Schema.Struct({
	app: Schema.optionalKey(App),
	name: Schema.annotateEncoded<Schema.NonEmptyString>({
		description: 'Exact span name, such as "notes.search" or "GET /api/notes".'
	})(Schema.NonEmptyString),
	since: Since
})

export type OperationRow = typeof OperationRow.Type
export const OperationRow = Schema.Struct({
	failure: Schema.optionalKey(
		Schema.Struct({error: Schema.optionalKey(Schema.String), span: Schema.String, trace: TraceId})
	),
	failures: Schema.optionalKey(Schema.Int),
	name: Schema.String,
	p50Ms: Schema.Finite,
	p95Ms: Schema.Finite,
	runs: Schema.Int,
	side: Schema.optionalKey(Side),
	slowest: TraceId
})

export type OperationsAnswer = typeof OperationsAnswer.Type
export const OperationsAnswer = Schema.Struct({
	apps: Schema.Array(Schema.Struct({app: Schema.String, operations: Schema.Array(OperationRow)}))
})

export type TraceRow = typeof TraceRow.Type
export const TraceRow = Schema.Struct({
	app: Schema.String,
	at: Schema.String.annotate({description: 'ISO-8601 trace start timestamp.'}),
	failure: Schema.optionalKey(
		Schema.String.annotate({description: 'Failing span name and error message, not a span id.'})
	),
	id: TraceId,
	ms: Schema.Finite.annotate({description: 'Trace duration in milliseconds.'}),
	operation: Schema.String,
	server: Schema.optionalKey(Schema.String),
	side: Schema.optionalKey(Side),
	spans: Schema.Int,
	tool: Schema.optionalKey(Schema.String)
})

export type TracesAnswer = typeof TracesAnswer.Type
export const TracesAnswer = Schema.Struct({
	nextCursor: Schema.optionalKey(TraceCursor),
	total: Schema.Int,
	traces: Schema.Array(TraceRow)
})

export type ReadSpan = typeof ReadSpan.Type
export const ReadSpan = Schema.Struct({
	app: Schema.String,
	at: Schema.Finite.annotate({description: 'Start offset from the trace start in milliseconds.'}),
	attrs: Schema.optionalKey(ToolAttributes),
	denied: Schema.optionalKey(Schema.Boolean),
	error: Schema.optionalKey(Schema.String),
	id: Schema.String,
	logs: Schema.optionalKey(Schema.Array(CompactLog)),
	ms: Schema.Finite.annotate({description: 'Span duration in milliseconds.'}),
	name: Schema.String,
	parent: Schema.optionalKey(Schema.String),
	side: Schema.optionalKey(Side)
})

export type ReadTraceAnswer = typeof ReadTraceAnswer.Type
export const ReadTraceAnswer = Schema.Struct({
	at: Schema.String.annotate({description: 'ISO-8601 trace start timestamp.'}),
	failure: Schema.optionalKey(Schema.String.annotate({description: 'Failing span id; locate it in spans.'})),
	id: TraceId,
	logs: Schema.optionalKey(Schema.Array(CompactLog)),
	ms: Schema.Finite,
	omitted: Schema.optionalKey(Schema.Int),
	spans: Schema.Array(ReadSpan)
})

export type LogRow = typeof LogRow.Type
export const LogRow = Schema.Struct({
	app: Schema.String,
	at: Schema.String,
	attrs: Schema.optionalKey(ToolAttributes),
	level: LogLevel,
	message: Schema.String,
	side: Schema.optionalKey(Side),
	span: Schema.optionalKey(Schema.String),
	trace: Schema.optionalKey(TraceId)
})

export type LogsAnswer = typeof LogsAnswer.Type
export const LogsAnswer = Schema.Struct({
	logs: Schema.Array(LogRow),
	nextCursor: Schema.optionalKey(LogCursor),
	total: Schema.Int
})

export type LatencyAnswer = typeof LatencyAnswer.Type
export const LatencyAnswer = Schema.Struct({
	count: Schema.Int,
	failures: Schema.Int,
	maxMs: Schema.Finite,
	p50Ms: Schema.Finite,
	p95Ms: Schema.Finite
})

export type IngestionService = typeof IngestionService.Type
export const IngestionService = Schema.Struct({
	app: Schema.String,
	entries: Schema.Int,
	lastEvent: Schema.String,
	release: Schema.optionalKey(Schema.String),
	runStarted: Schema.String,
	side: Schema.optionalKey(Side)
})

export type IngestionRejection = typeof IngestionRejection.Type
export const IngestionRejection = Schema.Struct({
	count: Schema.Int,
	credential: Schema.Literals(['authorization', 'cookie', 'none']),
	lastAt: Schema.String,
	route: Schema.Literals(['/v1/traces', '/v1/logs']),
	status: Schema.Int
})

export type IngestionAnswer = typeof IngestionAnswer.Type
export const IngestionAnswer = Schema.Struct({
	rejections: Schema.optionalKey(Schema.Array(IngestionRejection)),
	services: Schema.Array(IngestionService)
})
