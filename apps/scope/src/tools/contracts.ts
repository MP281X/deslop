import {Schema, pipe} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {
	Filters,
	Page,
	PageFilters,
	Service,
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
			'List the apps sending telemetry in their current run, with their runtime: web, mobile or server. Call it first: the other tools filter by these exact names.',
		failure: TelemetryError,
		success: Schema.Struct({services: Schema.Array(Service)})
	}).annotate(Tool.Readonly, true),
	Tool.make('find_traces', {
		description:
			'Find traces, each one request or user action across client and server, newest or slowest first. Call it after reproducing a bug, or with sort "slowest" before claiming an action is fast; then open one with read_trace.',
		failure: TelemetryError,
		parameters: SortFilters,
		success: TracesPage
	}).annotate(Tool.Readonly, true),
	Tool.make('read_trace', {
		description:
			'Read one trace whole: every span in parent order with its depth, start offset, runtime and logs. Shows where an action spent its time and which span failed.',
		failure: TelemetryError,
		parameters: Schema.Struct({
			id: pipe(TraceId, Schema.annotateEncoded({description: 'The 32-character id from find_traces or a span.'}))
		}),
		success: Trace
	}).annotate(Tool.Readonly, true),
	Tool.make('find_logs', {
		description:
			'Find what the apps logged, newest first, with or without a span; errors: true keeps only failures. Call it to see what happened during a reproduced bug.',
		failure: TelemetryError,
		parameters: PageFilters,
		success: Page
	}).annotate(Tool.Readonly, true),
	Tool.make('find_spans', {
		description:
			'Find single spans with their original OTLP attributes and events, when one operation matters more than its trace, such as every failed call to one endpoint.',
		failure: TelemetryError,
		parameters: SortFilters,
		success: Page
	}).annotate(Tool.Readonly, true),
	Tool.make('measure_latency', {
		description:
			'Count, errors and p50, p95 and max latency of the matching spans over the lookback. Run it on the same operation before and after a change to prove it got faster.',
		failure: TelemetryError,
		parameters: Filters,
		success: Stats
	}).annotate(Tool.Readonly, true)
)
