import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {DeployError, ExposeRequest, HideRequest, Snapshot} from '#services/inventory/schema.ts'
import {HistoryQuery, MachineHistory} from '#services/metrics/schema.ts'

export const Tools = Toolkit.make(
	Tool.make('resource_history', {
		description:
			'Recorded CPU, RAM, swap, storage, network and disk I/O for every configured machine over 1, 24 or 168 hours. Rates are absent before a baseline or after a sampling gap; unavailable workers retain stale last-known history.',
		failure: DeployError,
		parameters: HistoryQuery,
		success: Schema.Array(MachineHistory)
	}).annotate(Tool.Readonly, true),
	Tool.make('inventory', {
		description:
			'Current systemd services, Docker containers, listening ports and source errors. Observing a listener does not prove external reachability.',
		failure: DeployError,
		success: Snapshot
	}).annotate(Tool.Readonly, true),
	Tool.make('expose_port', {
		description:
			'Publish a loopback backend through private Tailscale Serve or owned public Caddy HTTPS. Public exposure requires explicit publicAccess=true; this adds no backend authentication and starts no application. target must name a configured worker or be omitted for this worker.',
		failure: DeployError,
		parameters: ExposeRequest,
		success: Schema.String
	}).annotate(Tool.Destructive, true),
	Tool.make('hide_exposure', {
		description:
			'Remove only an exposure Deploy owns, on this worker or a configured target. Stops its URL, not the backend process. Refuses externally changed Tailscale mappings.',
		failure: DeployError,
		parameters: HideRequest
	}).annotate(Tool.Destructive, true)
)
