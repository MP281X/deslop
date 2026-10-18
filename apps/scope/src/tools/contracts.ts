import {Schema} from 'effect'

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
	Tool.make('services', {
		description: 'List the services with current runs and their runtime: web, mobile or server.',
		failure: TelemetryError,
		success: Schema.Struct({services: Schema.Array(Service)})
	}).annotate(Tool.Readonly, true),
	Tool.make('traces', {
		description: 'Search traces, newest or slowest first. The total counts every match; page with offset.',
		failure: TelemetryError,
		parameters: SortFilters,
		success: TracesPage
	}).annotate(Tool.Readonly, true),
	Tool.make('spans', {
		description: 'Search single spans with their original OTLP fields.',
		failure: TelemetryError,
		parameters: SortFilters,
		success: Page
	}).annotate(Tool.Readonly, true),
	Tool.make('logs', {
		description: 'Search logs, standalone or attached to a span, newest first.',
		failure: TelemetryError,
		parameters: PageFilters,
		success: Page
	}).annotate(Tool.Readonly, true),
	Tool.make('stats', {
		description: 'Span count, errors and p50, p95 and max latency over the whole window.',
		failure: TelemetryError,
		parameters: Filters,
		success: Stats
	}).annotate(Tool.Readonly, true),
	Tool.make('trace', {
		description:
			'Read one trace whole: spans in parent order with depth, offset, runtime and their logs. No window or cap.',
		failure: TelemetryError,
		parameters: Schema.Struct({id: TraceId}),
		success: Trace
	}).annotate(Tool.Readonly, true)
)
