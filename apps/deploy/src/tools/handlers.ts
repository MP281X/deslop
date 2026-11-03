import {Array, Effect} from 'effect'

import {Fleet} from '#services/fleet/service.ts'
import {compactHistory} from '#services/metrics/lib/utils.ts'
import type {HistoryQuery} from '#services/metrics/schema.ts'
import {Tools} from '#tools/contracts.ts'

export const ToolHandlers = Tools.toLayer(
	Effect.map(Fleet, fleet =>
		Tools.of({
			expose_port: fleet.expose,
			hide_exposure: fleet.hide,
			inventory: () => fleet.snapshot,
			resource_history: Effect.fnUntraced(function* (query: HistoryQuery) {
				return Array.map(yield* fleet.metrics(query), machine => compactHistory(machine, query.minutes))
			})
		})
	)
)
