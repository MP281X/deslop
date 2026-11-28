import {Duration, Function, Option, Schema, SchemaGetter, Struct, pipe} from 'effect'

import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {AppName, ReleaseVersion, Side, Span, SpanId, TraceId} from '#telemetry/contract.ts'

export type Nano = typeof Nano.Type
// OTLP's decimal epoch nanoseconds stay exact until ingestion projects a stored instant or duration.
export const Nano = pipe(
	Schema.String.check(Schema.isPattern(/^\d{1,20}$/u)),
	Schema.decodeTo(Schema.Duration.check(Schema.makeFilter(Duration.isFinite, {expected: 'finite epoch nanoseconds'})), {
		decode: SchemaGetter.transform(value => Duration.nanos(BigInt(value))),
		encode: SchemaGetter.transform(value => Duration.toNanosUnsafe(value).toString())
	})
)

export type SpanIdFromEmpty = typeof SpanIdFromEmpty.Type
// Senders that emit blank IDs should correlate the same way as senders that omit them.
export const SpanIdFromEmpty = pipe(
	Schema.OptionFromOptionalKey(Schema.Union([SpanId, Schema.Literal('')])),
	Schema.decodeTo(Schema.Option(Schema.toType(SpanId)), {
		decode: SchemaGetter.transform(value => Option.filter(value, (id): id is SpanId => id !== '')),
		encode: SchemaGetter.transform(Function.identity)
	})
)

export type TraceIdFromEmpty = typeof TraceIdFromEmpty.Type
export const TraceIdFromEmpty = pipe(
	Schema.OptionFromOptionalKey(Schema.Union([TraceId, Schema.Literal('')])),
	Schema.decodeTo(Schema.Option(Schema.toType(TraceId)), {
		decode: SchemaGetter.transform(value => Option.filter(value, (id): id is TraceId => id !== '')),
		encode: SchemaGetter.transform(Function.identity)
	})
)

export type Attribute = typeof Attribute.Type
export const Attribute = Schema.Struct({key: Schema.String, value: Schema.JsonObject})

export type Resource = typeof Resource.Type
// Vendor fields should survive decoding without becoming requirements for other exporters.
export const Resource = Schema.Struct({attributes: Schema.OptionFromOptionalKey(Schema.Array(Attribute))}).annotate({
	parseOptions: {onExcessProperty: 'preserve'}
})

export type SpanDetails = typeof SpanDetails.Type
export const SpanDetails = Schema.Struct({
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
	// Optional in OTLP, where 0 also means unknown.
	timeUnixNano: Schema.OptionFromOptionalKey(Nano),
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

// Who wrote an export: GitHub's signed webhook, a caller Auth identified by tailnet device or sign-in, or an anonymous OTLP exporter.
export type Origin = typeof Origin.Type
export const Origin = Schema.Literals(['github', 'identified', 'anonymous'])

export type ServiceRun = typeof ServiceRun.Type
// Each service's latest run, the one with the newest stored span start or log time: how much it sent, when it last did, and what it said it was.
export const ServiceRun = Schema.Struct({
	...Struct.pick(Span.fields, ['run', 'runtime', 'service', 'version']),
	entries: Schema.Int,
	lastEvent: DateTimeUtcFromFiniteMillis
})

export type Rejection = typeof Rejection.Type
export const Rejection = Schema.Struct({
	count: Schema.Natural,
	credential: Schema.Literals(['authorization', 'cookie', 'none']),
	lastAt: DateTimeUtcFromFiniteMillis,
	route: Schema.Literals(['/v1/traces', '/v1/logs']),
	status: Schema.Int
})

export type RejectedExport = typeof RejectedExport.Type
export const RejectedExport = Schema.Struct(Struct.pick(Rejection.fields, ['credential', 'route', 'status']))

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
