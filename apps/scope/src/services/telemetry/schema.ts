import {Effect, Schema, Struct, pipe} from 'effect'

const RANGE_MS: Record<Range, number> = {'1h': 3_600_000, '3d': 259_200_000, '10m': 600_000, '24h': 86_400_000}

export class TelemetryError extends Schema.TaggedError<TelemetryError>()('TelemetryError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type TraceId = typeof TraceId.Type
export const TraceId = pipe(Schema.String, Schema.check(Schema.isPattern(/^[a-fA-F0-9]{32}$/u)))

type SpanId = typeof SpanId.Type
const SpanId = pipe(Schema.String, Schema.check(Schema.isPattern(/^[a-fA-F0-9]{16}$/u)))

export type Nano = typeof Nano.Type
export const Nano = pipe(Schema.String, Schema.check(Schema.isPattern(/^\d{1,20}$/u)))

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

export type Span = typeof Span.Type
const Span = Schema.StructWithRest(
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

type Log = typeof Log.Type
const Log = Schema.StructWithRest(
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
									spans: Schema.optionalKey(Schema.Array(Span))
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
									logRecords: Schema.optionalKey(Schema.Array(Log)),
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

export type SpanLink = typeof SpanLink.Type
export const SpanLink = Schema.Struct({spanId: Schema.String, traceId: Schema.String})

export type Entry = typeof Entry.Type
export const Entry = Schema.Struct({
	// A failed span whose only failures are a denied sign-in: not a failure for any count or marker.
	denied: Schema.optionalKey(Schema.Boolean),
	durationMs: Schema.Finite,
	id: Schema.NonEmptyString,
	// The span's OTLP links, judged once when the entry arrives rather than on every trace view.
	links: Schema.optionalKey(Schema.Array(SpanLink)),
	name: Schema.String,
	payload: Schema.JsonObject,
	receivedAt: Schema.Natural,
	resource: Resource,
	service: Schema.String,
	signal: Schema.Literals(['trace', 'log']),
	spanId: Schema.String,
	status: Schema.Int,
	time: Nano,
	traceId: Schema.String
})

// What the tools answer for an entry: `service` already names its resource, so a page stays small enough to read.
type EntryItem = typeof EntryItem.Type
const EntryItem = Entry.mapFields(Struct.omit(['resource']))

export type Range = typeof Range.Type
// The page's time frame and the tools' window; three days is what the store keeps.
export const Range = Schema.Literals(['10m', '1h', '24h', '3d'])

export function rangeMs(range: Range) {
	return RANGE_MS[range]
}

// The oldest start a frame holds, in nanoseconds.
export function rangeStart(range: Range, now: number) {
	return BigInt(now - rangeMs(range)) * 1_000_000n
}

export type Runtime = typeof Runtime.Type
export const Runtime = Schema.Literals(['web', 'mobile', 'server', 'ci', 'unknown'])

// The side the tools name instead of a package suffix; a resource without one falls back to its service name.
export type Side = typeof Side.Type
export const Side = Schema.Literals(['web', 'mobile', 'server', 'ci'])

export type Service = typeof Service.Type
export const Service = Schema.Struct({name: Schema.String, runtime: Runtime})

export type ServiceStatus = typeof ServiceStatus.Type
export const ServiceStatus = Schema.Struct({
	...Service.fields,
	entries: Schema.Natural,
	lastEventAt: Nano,
	runStartedAt: Nano,
	// The release its latest run sent; empty for a local build. Scope keeps only each service's newest release.
	version: Schema.String
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
	durationMs: Schema.Finite,
	failure: Schema.optionalKey(Schema.Struct({error: Schema.optionalKey(Schema.String), span: Schema.String})),
	id: TraceId,
	label: Schema.optionalKey(Schema.String),
	time: Nano
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
	traces: Schema.Array(OperationTrace)
})

export type Overview = typeof Overview.Type
export const Overview = Schema.Struct({
	apps: Schema.Array(
		Schema.Struct({ci: Schema.optionalKey(Schema.Boolean), name: Schema.String, operations: Schema.Array(Operation)})
	)
})

type TraceSpan = typeof TraceSpan.Type
const TraceSpan = Schema.Struct({
	...Struct.omit(EntryItem.fields, ['links']),
	depth: Schema.Natural,
	logs: Schema.Array(EntryItem),
	offsetMs: Schema.Finite,
	parentSpanId: Schema.String,
	runtime: Runtime
})

export type Trace = typeof Trace.Type
export const Trace = Schema.Struct({
	durationMs: Schema.Finite,
	failureSpanId: Schema.optionalKey(Schema.String),
	id: TraceId,
	logs: Schema.Array(EntryItem),
	services: Schema.Array(Service),
	spans: Schema.Array(TraceSpan)
})

type ATTRIBUTE_VALUE = typeof ATTRIBUTE_VALUE.Type
const ATTRIBUTE_VALUE = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean])
type Attributes = typeof Attributes.Type
const Attributes = Schema.Record(Schema.String, ATTRIBUTE_VALUE)

export type LogLevel = typeof LogLevel.Type
export const LogLevel = Schema.Literals(['debug', 'error', 'info', 'trace', 'warn'])

export type CompactLog = typeof CompactLog.Type
export const CompactLog = Schema.Struct({at: Schema.String, level: LogLevel, message: Schema.String})

type App = typeof App.Type
// The tools' inputs: every field optional except where a tool cannot answer without it.
const App = pipe(
	Schema.String,
	Schema.annotateEncoded({description: 'App name as list_operations shows it, such as "trips"; omit for every app.'})
)

export const Since = pipe(
	Range,
	Schema.withDecodingDefaultTypeKey(Effect.succeed('1h' as const)),
	Schema.annotateEncoded({description: "Time window: '10m', '1h', '24h' or '3d'; default '1h'."})
)

export type ListOperationsParams = typeof ListOperationsParams.Type
export const ListOperationsParams = Schema.Struct({app: Schema.optionalKey(App), since: Since})

export type FindTracesParams = typeof FindTracesParams.Type
export const FindTracesParams = Schema.Struct({
	app: Schema.optionalKey(App),
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
	id: pipe(
		TraceId,
		Schema.annotateEncoded({description: 'The full 32-hex trace id from list_operations or find_traces.'})
	),
	limit: pipe(
		Schema.Int,
		Schema.check(Schema.isBetween({maximum: 1000, minimum: 1})),
		Schema.withDecodingDefaultTypeKey(Effect.succeed(100)),
		Schema.annotateEncoded({description: 'Spans to return, 1 to 1000; default 100.'})
	)
})

export type SearchLogsParams = typeof SearchLogsParams.Type
export const SearchLogsParams = Schema.Struct({
	app: Schema.optionalKey(App),
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
	name: pipe(
		Schema.NonEmptyString,
		Schema.annotateEncoded({description: 'Exact span name, such as "notes.search" or "GET /api/notes".'})
	),
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
	at: Schema.String,
	failure: Schema.optionalKey(Schema.String),
	id: TraceId,
	ms: Schema.Finite,
	operation: Schema.String,
	side: Schema.optionalKey(Side),
	spans: Schema.Int
})

export type TracesAnswer = typeof TracesAnswer.Type
export const TracesAnswer = Schema.Struct({total: Schema.Int, traces: Schema.Array(TraceRow)})

export type ReadSpan = typeof ReadSpan.Type
export const ReadSpan = Schema.Struct({
	app: Schema.String,
	at: Schema.Finite,
	attrs: Schema.optionalKey(Attributes),
	denied: Schema.optionalKey(Schema.Boolean),
	error: Schema.optionalKey(Schema.String),
	id: Schema.String,
	logs: Schema.optionalKey(Schema.Array(CompactLog)),
	ms: Schema.Finite,
	name: Schema.String,
	parent: Schema.optionalKey(Schema.String),
	side: Schema.optionalKey(Side)
})

export type ReadTraceAnswer = typeof ReadTraceAnswer.Type
export const ReadTraceAnswer = Schema.Struct({
	at: Schema.String,
	failure: Schema.optionalKey(Schema.String),
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
	attrs: Schema.optionalKey(Attributes),
	level: LogLevel,
	message: Schema.String,
	side: Schema.optionalKey(Side),
	span: Schema.optionalKey(Schema.String),
	trace: Schema.optionalKey(TraceId)
})

export type LogsAnswer = typeof LogsAnswer.Type
export const LogsAnswer = Schema.Struct({logs: Schema.Array(LogRow), total: Schema.Int})

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
