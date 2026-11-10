import {Effect} from 'effect'

import {Fleet} from '#services/fleet/service.ts'
import {jobRequest, listApps, ownerNames} from '#services/inventory/lib/tools.ts'
import {resourceHistory} from '#services/metrics/lib/tools.ts'
import {Tools} from '#tools/contracts.ts'

export const ToolHandlers = Tools.toLayer(
	Effect.map(Fleet, fleet =>
		Tools.of({
			expose_port: input => Effect.map(fleet.expose(input), url => ({url})),
			hide_exposure: fleet.hide,
			list_apps: input => Effect.map(fleet.snapshot, snapshot => listApps(snapshot, input)),
			resource_history: Effect.fnUntraced(function* (input) {
				const value = yield* Effect.all(
					{machines: fleet.metrics({minutes: input.minutes}), snapshot: fleet.snapshot},
					{concurrency: 'unbounded'}
				)
				return resourceHistory(value.machines, input, ownerNames(value.snapshot))
			}),
			run_job: Effect.fnUntraced(function* (input) {
				yield* fleet.run(yield* jobRequest(yield* fleet.snapshot, input))
				return {started: true as const}
			})
		})
	)
)
