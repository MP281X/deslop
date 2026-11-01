import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {DeployError, ExposeRequest, HideRequest, Snapshot} from '#services/inventory/schema.ts'

export const Tools = Toolkit.make(
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
