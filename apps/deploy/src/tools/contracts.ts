import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {
	DeployError,
	ExposeRequest,
	HideRequest,
	ListApps,
	ListAppsInput,
	RunJobInput
} from '#services/inventory/schema.ts'
import {HistoryToolInput, ResourceHistory} from '#services/metrics/schema.ts'

export const Tools = Toolkit.make(
	Tool.make('list_apps', {
		description:
			'Start here to see what runs on the workers: apps, their state, ports and failures. Pass app to get its process tree, worker to choose a machine, failing for only failed or warning items.',
		failure: DeployError,
		parameters: ListAppsInput,
		success: ListApps
	}).annotate(Tool.Readonly, true),
	Tool.make('resource_history', {
		description:
			'Use to see memory, CPU or disk over time, or which app uses the most: 60 points at a fixed interval, the machine’s current figures and the heaviest apps. worker chooses a machine.',
		failure: DeployError,
		parameters: HistoryToolInput,
		success: ResourceHistory
	}).annotate(Tool.Readonly, true),
	Tool.make('expose_port', {
		description:
			'Use to give a local port an HTTPS URL on the tailnet or the public internet; publicAccess=true is required for public, and target names another configured worker. Returns {url}; it adds no authentication and starts no application.',
		failure: DeployError,
		parameters: ExposeRequest,
		success: Schema.Struct({url: Schema.String})
	}).annotate(Tool.Destructive, true),
	Tool.make('hide_exposure', {
		description:
			'Use to remove an HTTPS URL Deploy owns, stopping only the URL, not the backend. target names another configured worker; externally changed Tailscale mappings are refused.',
		failure: DeployError,
		parameters: HideRequest
	}).annotate(Tool.Destructive, true),
	Tool.make('run_job', {
		description:
			'Use to run a scheduled job now, by the name list_apps shows. Pass worker when both machines run the same job; returns {started: true}.',
		failure: DeployError,
		parameters: RunJobInput,
		success: Schema.Struct({started: Schema.Literal(true)})
	})
)
