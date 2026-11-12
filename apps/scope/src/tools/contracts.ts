import {Effect, Schema, Struct, pipe} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {
	FindTracesParams,
	IngestionAnswer,
	IngestionService,
	LatencyAnswer,
	ListOperationsParams,
	LogsAnswer,
	LogRow,
	MeasureLatencyParams,
	OperationsAnswer,
	ReadTraceAnswer,
	ReadTraceParams,
	ReadSpan,
	SearchLogsParams,
	TelemetryError,
	TracesAnswer
} from '#services/telemetry/schema.ts'

type TextWindow = typeof TextWindow.Type
const TextWindow = Schema.Struct({
	textLimit: pipe(
		Schema.Int.check(Schema.isBetween({maximum: 8000, minimum: 1})),
		Schema.withDecodingDefaultTypeKey(Effect.succeed(2000))
	),
	textOffset: pipe(Schema.Natural, Schema.withDecodingDefaultTypeKey(Effect.succeed(0)))
})

type AttributeWindow = typeof AttributeWindow.Type
const AttributeWindow = Schema.Struct({
	attribute: Schema.optionalKey(Schema.String),
	attributeCursor: Schema.optionalKey(Schema.String)
})

export const Tools = Toolkit.make(
	Tool.make('list_operations', {
		description:
			'Inspect root operations failure-first with runs and latency; denied sign-ins are not failures. Use a failure or slowest trace id with read_trace, or continue the live list with nextCursor.',
		failure: TelemetryError,
		parameters: Schema.Struct({
			...ListOperationsParams.fields,
			cursor: Schema.optionalKey(Schema.String),
			limit: pipe(
				Schema.Int.check(Schema.isBetween({maximum: 100, minimum: 1})),
				Schema.withDecodingDefaultTypeKey(Effect.succeed(30))
			),
			operation: Schema.optionalKey(Schema.String)
		}),
		success: Schema.Struct({...OperationsAnswer.fields, nextCursor: Schema.optionalKey(Schema.String)})
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true),
	Tool.make('find_traces', {
		description:
			'Find requests, actions or jobs by app, operation, span or text, newest or slowest first; rows include MCP server/tool identity when recorded. Continue with nextCursor and the same filters, or read_trace(id) for a selected trace.',
		failure: TelemetryError,
		parameters: FindTracesParams,
		success: TracesAnswer
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true),
	Tool.make('read_trace', {
		description:
			'Read a trace’s spans (at=offset ms, ms=duration), longest first selection in tree order, plus failing ancestors; pass nextOffset to continue. Select section=logs or attributes and optional span id for bounded details; nextTextOffset/nextAttribute continue truncated fields.',
		failure: TelemetryError,
		parameters: Schema.Struct({
			...ReadTraceParams.fields,
			...TextWindow.fields,
			...AttributeWindow.fields,
			logLimit: pipe(
				Schema.Int.check(Schema.isBetween({maximum: 100, minimum: 1})),
				Schema.withDecodingDefaultTypeKey(Effect.succeed(20))
			),
			offset: pipe(Schema.Natural, Schema.withDecodingDefaultTypeKey(Effect.succeed(0))),
			section: pipe(
				Schema.Literals(['spans', 'logs', 'attributes']),
				Schema.withDecodingDefaultTypeKey(Effect.succeed('spans' as const))
			),
			span: Schema.optionalKey(Schema.String)
		}),
		success: Schema.Struct({
			...Struct.omit(ReadTraceAnswer.fields, ['spans']),
			attributes: Schema.optionalKey(ReadSpan.fields.attrs.schema),
			nextAttribute: Schema.optionalKey(Schema.String),
			nextOffset: Schema.optionalKey(Schema.Natural),
			nextTextOffset: Schema.optionalKey(Schema.Natural),
			spans: Schema.Array(ReadSpan.mapFields(fields => Struct.omit(fields, ['attrs', 'logs'])))
		})
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true),
	Tool.make('search_logs', {
		description:
			'Find logs by text, app, severity or trace, newest first, including correlation ids for read_trace. Continue with nextCursor; textOffset and attributeCursor resume bounded messages and attributes with the same filters.',
		failure: TelemetryError,
		parameters: Schema.Struct({...SearchLogsParams.fields, ...TextWindow.fields, ...AttributeWindow.fields}),
		success: Schema.Struct({
			...LogsAnswer.fields,
			logs: Schema.Array(
				LogRow.mapFields(fields => ({
					...fields,
					nextAttribute: Schema.optionalKey(Schema.String),
					nextTextOffset: Schema.optionalKey(Schema.Natural)
				}))
			)
		})
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true),
	Tool.make('measure_latency', {
		description:
			'Measure count, failures and p50/p95/max milliseconds for an exact span name in one rolling window; save this result before a change to compare later. Zero samples is no evidence of success; find_traces locates individual requests.',
		failure: TelemetryError,
		parameters: MeasureLatencyParams,
		success: LatencyAnswer
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true),
	Tool.make('check_ingestion', {
		description:
			'Check missing or stale exporters by app, release, run start and last event; an absent service sent nothing in three days. Rejections are global because unauthenticated exports cannot be assigned to an app; use list_operations after ingestion resumes.',
		failure: TelemetryError,
		parameters: Schema.Struct({app: Schema.optionalKey(Schema.String)}),
		success: Schema.Struct({
			...IngestionAnswer.fields,
			services: Schema.Array(
				IngestionService.mapFields(fields => ({...fields, runStarted: Schema.optionalKey(Schema.String)}))
			)
		})
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true)
)
