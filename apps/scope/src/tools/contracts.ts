import {Schema, pipe} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {
	Filters,
	IngestionStatus,
	Page,
	SortFilters,
	Stats,
	TelemetryError,
	Trace,
	TraceId,
	TracesPage
} from '#services/telemetry/schema.ts'

export const Tools = Toolkit.make(
	Tool.make('list_services', {
		description:
			'Start here: each service with its latest run, last event and entry count, plus rejected exports. A service missing here sent nothing in the last three days.',
		failure: TelemetryError,
		success: IngestionStatus
	}).annotate(Tool.Readonly, true),
	Tool.make('find', {
		description:
			'Find traces (one request or action each), single spans with their attributes, or logs, newest or slowest first; searches the latest run of each service unless runs is "all". Open a trace with read_trace.',
		failure: TelemetryError,
		parameters: Schema.Struct({
			...SortFilters.fields,
			kind: Schema.Literals(['traces', 'spans', 'logs']).annotate({description: 'What to find.'})
		}),
		success: Schema.Union([TracesPage, Page])
	}).annotate(Tool.Readonly, true),
	Tool.make('read_trace', {
		description: 'One trace whole: every span in order with its depth, offset, duration and logs.',
		failure: TelemetryError,
		parameters: Schema.Struct({
			id: pipe(TraceId, Schema.annotateEncoded({description: 'The 32-character id from find.'}))
		}),
		success: Trace
	}).annotate(Tool.Readonly, true),
	Tool.make('measure_latency', {
		description:
			'Count, errors and p50, p95 and max milliseconds of the matching spans; run it before and after a change to compare.',
		failure: TelemetryError,
		parameters: Filters,
		success: Stats
	}).annotate(Tool.Readonly, true)
)
