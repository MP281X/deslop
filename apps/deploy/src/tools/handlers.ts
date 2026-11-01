import {Effect} from 'effect'

import {Fleet} from '#services/fleet/service.ts'
import {Tools} from '#tools/contracts.ts'

export const ToolHandlers = Tools.toLayer(
	Effect.map(Fleet, fleet =>
		Tools.of({
			expose_port: fleet.expose,
			hide_exposure: fleet.hide,
			inventory: () => fleet.snapshot,
			resource_history: fleet.metrics
		})
	)
)
