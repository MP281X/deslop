import {Effect, Schema, pipe} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {AuthError, CurrentUser} from '@deslop/runtime/shared/auth'

import {ExposeInput} from '#services/exposures/schema.ts'
import {
	ExposureName,
	DeployError,
	WorkerInventory,
	WorkerId,
	ManagedApp,
	InventoryCursor,
	InventoryQuery,
	RunJobInput
} from '#services/inventory/schema.ts'
import {HistoryToolInput, WorkerHistory} from '#services/metrics/schema.ts'

type MetricSummary = typeof MetricSummary.Type
const MetricSummary = Schema.Struct({
	last: Schema.OptionFromOptionalKey(Schema.Finite),
	max: Schema.OptionFromOptionalKey(Schema.Finite),
	min: Schema.OptionFromOptionalKey(Schema.Finite),
	samples: Schema.Int
})
const WorkerSummary = WorkerHistory.mapFields(fields => ({
	...fields,
	cpuPct: MetricSummary,
	diskPct: MetricSummary,
	memoryPct: MetricSummary
}))

type PageLimit = typeof PageLimit.Type
const PageLimit = pipe(
	Schema.Int.check(Schema.isBetween({maximum: 100, minimum: 1})),
	Schema.withDecodingDefaultTypeKey(Effect.succeed(30))
)

export const ToolContracts = Toolkit.make(
	Tool.make('list_apps', {
		description:
			'Inspect worker apps, jobs and owned HTTPS exposures; app focuses on matching names and includes process trees. Continue with nextCursor; processOffset pages a focused app’s tree, retaining ancestors of selected nodes.',
		failure: DeployError,
		parameters: Schema.Struct({
			...InventoryQuery.fields,
			cursor: Schema.OptionFromOptionalKey(InventoryCursor),
			limit: PageLimit,
			processLimit: PageLimit,
			processOffset: pipe(Schema.Natural, Schema.withDecodingDefaultTypeKey(Effect.succeed(0)))
		}),
		success: Schema.Struct({
			nextCursor: Schema.OptionFromOptionalKey(InventoryCursor),
			workers: Schema.Array(
				WorkerInventory.mapFields(fields => ({
					...fields,
					apps: Schema.Array(
						Schema.Struct({
							...ManagedApp.fields,
							nextProcessOffset: Schema.OptionFromOptionalKey(Schema.Natural),
							processesOmitted: Schema.OptionFromOptionalKey(Schema.Natural)
						})
					)
				}))
			)
		})
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true),
	Tool.make('read_resource_history', {
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
	Tool.make('create_exposure', {
		dependencies: [CurrentUser],
		description:
			'Give a listening local port the requested HTTPS hostname and ownership name on a configured worker; public exposure requires explicit publicAccess=true consent. Caddy’s admin port is refused, and a Deslop app’s port is published only under the app’s own name and only when it runs with a domain. Returns the URL, adds no authentication and starts no application; list_apps shows owned exposures.',
		failure: Schema.Union([AuthError, DeployError]),
		parameters: Schema.Struct({...ExposeInput.fields, worker: Schema.OptionFromOptionalKey(WorkerId)}),
		success: Schema.Struct({url: Schema.String})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true),
	Tool.make('remove_exposure', {
		dependencies: [CurrentUser],
		description:
			'Remove an HTTPS exposure Deploy owns by name and optional worker from list_apps, not its backend. Externally changed Tailscale mappings are refused; an accepted removal is saved first, finishes on its own when this call fails and is never undone.',
		failure: Schema.Union([AuthError, DeployError]),
		parameters: Schema.Struct({
			name: ExposureName.check(Schema.isNonEmpty()),
			worker: Schema.OptionFromOptionalKey(WorkerId)
		}),
		success: Schema.Struct({name: ExposureName, worker: Schema.OptionFromOptionalKey(WorkerId)})
	})
		.annotate(Tool.Destructive, true)
		.annotate(Tool.Strict, true),
	Tool.make('run_job', {
		dependencies: [CurrentUser],
		description:
			'Start a scheduled job now by name from list_apps; pass worker to disambiguate machines. started means accepted, not completed; inspect list_apps or Scope for the outcome.',
		failure: Schema.Union([AuthError, DeployError]),
		parameters: RunJobInput,
		success: Schema.Struct({started: Schema.Literal(true)})
	}).annotate(Tool.Strict, true)
)
