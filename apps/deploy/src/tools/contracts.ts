import {Effect, Schema, pipe} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {DeployError, Exposure, WorkerApps, ListApp, ListAppsInput, RunJobInput} from '#services/inventory/schema.ts'
import {HistoryToolInput, WorkerHistory} from '#services/metrics/schema.ts'

type MetricSummary = typeof MetricSummary.Type
const MetricSummary = Schema.Struct({
	last: Schema.optionalKey(Schema.Finite),
	max: Schema.optionalKey(Schema.Finite),
	min: Schema.optionalKey(Schema.Finite),
	samples: Schema.Int
})
const WorkerSummary = WorkerHistory.mapFields(fields => ({
	...fields,
	cpuPct: MetricSummary,
	diskPct: MetricSummary,
	memoryPct: MetricSummary
}))

export const Tools = Toolkit.make(
	Tool.make('list_apps', {
		description:
			'Inspect worker apps, jobs and owned HTTPS exposures; app focuses on matching names and includes process trees. Continue with nextCursor; processOffset pages a focused app’s tree, retaining ancestors of selected nodes.',
		failure: DeployError,
		parameters: Schema.Struct({
			...ListAppsInput.fields,
			cursor: Schema.optionalKey(Schema.String),
			limit: pipe(
				Schema.Int.check(Schema.isBetween({maximum: 100, minimum: 1})),
				Schema.withDecodingDefaultTypeKey(Effect.succeed(30))
			),
			processLimit: pipe(
				Schema.Int.check(Schema.isBetween({maximum: 100, minimum: 1})),
				Schema.withDecodingDefaultTypeKey(Effect.succeed(30))
			),
			processOffset: pipe(Schema.Natural, Schema.withDecodingDefaultTypeKey(Effect.succeed(0)))
		}),
		success: Schema.Struct({
			nextCursor: Schema.optionalKey(Schema.String),
			workers: Schema.Array(
				WorkerApps.mapFields(fields => ({
					...fields,
					apps: Schema.Array(
						Schema.Struct({
							...ListApp.fields,
							nextProcessOffset: Schema.optionalKey(Schema.Natural),
							processesOmitted: Schema.optionalKey(Schema.Natural)
						})
					)
				}))
			)
		})
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true),
	Tool.make('resource_history', {
		description:
			'Inspect current capacity, memory-ranked consumers and min/max/last resource percentages with sample coverage. Set series=true for the aligned 60-point history with null gaps when timing or spikes matter.',
		failure: DeployError,
		parameters: Schema.Struct({
			...HistoryToolInput.fields,
			series: pipe(Schema.Boolean, Schema.withDecodingDefaultTypeKey(Effect.succeed(false)))
		}),
		success: Schema.Struct({workers: Schema.Array(Schema.Union([WorkerSummary, WorkerHistory]))})
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true),
	Tool.make('expose_port', {
		description:
			'Give a local port the requested HTTPS hostname and ownership name on a configured worker; public exposure requires explicit publicAccess=true consent. Returns the URL, adds no authentication and starts no application; list_apps shows owned exposures.',
		failure: DeployError,
		parameters: Schema.Struct({...Exposure.fields, worker: Schema.optionalKey(Schema.String)}),
		success: Schema.Struct({url: Schema.String})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true),
	Tool.make('hide_exposure', {
		description:
			'Remove an HTTPS exposure Deploy owns by name and optional worker from list_apps, not its backend. Externally changed Tailscale mappings are refused; inspect list_apps after an uncertain failure.',
		failure: DeployError,
		parameters: Schema.Struct({name: Schema.NonEmptyString, worker: Schema.optionalKey(Schema.String)}),
		success: Schema.Struct({name: Schema.String, worker: Schema.optionalKey(Schema.String)})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true),
	Tool.make('run_job', {
		description:
			'Start a scheduled job now by name from list_apps; pass worker to disambiguate machines. started means accepted, not completed; inspect list_apps or Scope for the outcome.',
		failure: DeployError,
		parameters: RunJobInput,
		success: Schema.Struct({started: Schema.Literal(true)})
	}).annotate(Tool.Strict, true)
)
