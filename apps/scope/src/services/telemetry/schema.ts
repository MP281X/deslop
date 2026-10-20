import {Duration, Effect, Schema, pipe} from 'effect'

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

type Attribute = typeof Attribute.Type
const Attribute = Schema.Struct({key: Schema.String, value: Schema.JsonObject})

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

type Span = typeof Span.Type
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
		timeUnixNano: Schema.optionalKey(Nano),
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

export type Entry = typeof Entry.Type
export const Entry = Schema.Struct({
	durationMs: Schema.Finite,
	id: Schema.NonEmptyString,
	name: Schema.String,
	payload: Schema.JsonObject,
	resource: Resource,
	resourceSchemaUrl: Schema.String,
	scope: Resource,
	scopeSchemaUrl: Schema.String,
	service: Schema.String,
	signal: Schema.Literals(['trace', 'log']),
	spanId: Schema.String,
	status: Schema.Int,
	time: Nano,
	traceId: Schema.String
})

export type Query = typeof Query.Type
export const Query = Schema.Struct({
	errors: Schema.Boolean,
	from: Schema.Finite,
	limit: pipe(Schema.Int, Schema.check(Schema.isBetween({maximum: 1000, minimum: 1}))),
	offset: Schema.Natural,
	operation: Schema.String,
	service: Schema.String,
	sort: Schema.Literals(['recent', 'slowest']),
	text: Schema.String,
	to: Schema.Finite,
	traceId: Schema.String
})

export type Page = typeof Page.Type
export const Page = Schema.Struct({entries: Schema.Array(Entry), total: Schema.Int})

export type Runtime = typeof Runtime.Type
export const Runtime = Schema.Literals(['web', 'mobile', 'server', 'unknown'])

export type Service = typeof Service.Type
export const Service = Schema.Struct({name: Schema.String, runtime: Runtime})

export type TraceSummary = typeof TraceSummary.Type
export const TraceSummary = Schema.Struct({
	durationMs: Schema.Finite,
	errors: Schema.Int,
	id: TraceId,
	logs: Schema.Int,
	operation: Schema.String,
	service: Schema.String,
	services: Schema.Array(Service),
	spans: Schema.Int,
	time: Nano
})

export type TracesPage = typeof TracesPage.Type
export const TracesPage = Schema.Struct({entries: Schema.Array(TraceSummary), total: Schema.Int})

export type Stats = typeof Stats.Type
export const Stats = Schema.Struct({
	count: Schema.Int,
	errors: Schema.Int,
	from: Schema.Finite,
	maxMs: Schema.Finite,
	p50Ms: Schema.Finite,
	p95Ms: Schema.Finite,
	to: Schema.Finite
})

type TraceSpan = typeof TraceSpan.Type
const TraceSpan = Schema.Struct({
	...Entry.fields,
	depth: Schema.Natural,
	logs: Schema.Array(Entry),
	offsetMs: Schema.Finite,
	parentSpanId: Schema.String,
	runtime: Runtime
})

export type Trace = typeof Trace.Type
export const Trace = Schema.Struct({
	durationMs: Schema.Finite,
	id: TraceId,
	logs: Schema.Array(Entry),
	services: Schema.Array(Service),
	spans: Schema.Array(TraceSpan)
})

export type StoredEntry = typeof StoredEntry.Type
export const StoredEntry = Schema.Struct({json: Schema.fromJsonString(Entry)})

// The tools' inputs; `since` becomes the query's window when the tool runs.
export type Filters = typeof Filters.Type
export const Filters = Schema.Struct({
	errors: pipe(
		Query.fields.errors,
		Schema.withDecodingDefaultTypeKey(Effect.succeed(false)),
		Schema.annotateEncoded({description: 'Only failed spans and error logs.'})
	),
	operation: pipe(
		Query.fields.operation,
		Schema.withDecodingDefaultTypeKey(Effect.succeed('')),
		Schema.annotateEncoded({description: 'Exact span name.'})
	),
	service: pipe(
		Query.fields.service,
		Schema.withDecodingDefaultTypeKey(Effect.succeed('')),
		Schema.annotateEncoded({description: 'Exact service name, from list_services.'})
	),
	since: pipe(
		Schema.DurationFromString,
		Schema.check(Schema.makeFilter(Duration.isFinite, {expected: 'a finite duration'})),
		Schema.withDecodingDefaultTypeKey(Effect.succeed(Duration.minutes(10))),
		Schema.annotateEncoded({description: 'Lookback, such as "10 minutes" or "1 hour".'})
	),
	text: pipe(
		Query.fields.text,
		Schema.withDecodingDefaultTypeKey(Effect.succeed('')),
		Schema.annotateEncoded({description: 'Case-insensitive text in the span name, log message or attributes.'})
	),
	traceId: pipe(
		Query.fields.traceId,
		Schema.withDecodingDefaultTypeKey(Effect.succeed('')),
		Schema.annotateEncoded({description: 'Only entries of this trace.'})
	)
})

export type PageFilters = typeof PageFilters.Type
export const PageFilters = Schema.Struct({
	...Filters.fields,
	limit: pipe(
		Query.fields.limit,
		Schema.withDecodingDefaultTypeKey(Effect.succeed(100)),
		Schema.annotateEncoded({description: 'Page size, 1 to 1000.'})
	),
	offset: pipe(
		Query.fields.offset,
		Schema.withDecodingDefaultTypeKey(Effect.succeed(0)),
		Schema.annotateEncoded({description: 'Entries to skip, for the next page.'})
	)
})

export type SortFilters = typeof SortFilters.Type
export const SortFilters = Schema.Struct({
	...PageFilters.fields,
	sort: pipe(
		Query.fields.sort,
		Schema.withDecodingDefaultTypeKey(Effect.succeed('recent' as const)),
		Schema.annotateEncoded({description: '"recent" puts the newest first, "slowest" the longest first.'})
	)
})
