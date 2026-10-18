import {Clock, Duration, Effect} from 'effect'

import type {Filters, Query} from '#services/telemetry/schema.ts'
import {Telemetry} from '#services/telemetry/service.ts'
import {Tools} from '#tools/contracts.ts'

// Stats reads the whole window, so its page and order are only the query's required fields.
const query = Effect.fnUntraced(function* (filters: Filters & Partial<Pick<Query, 'limit' | 'offset' | 'sort'>>) {
	const now = yield* Clock.currentTimeMillis
	return {
		limit: 1000,
		offset: 0,
		sort: 'recent' as const,
		...filters,
		from: now - Duration.toMillis(filters.since),
		to: now
	}
})

export const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const telemetry = yield* Telemetry
		return Tools.of({
			logs: filters => Effect.flatMap(query(filters), telemetry.logs),
			services: () => Effect.map(telemetry.services(), services => ({services})),
			spans: filters => Effect.flatMap(query(filters), telemetry.spans),
			stats: filters => Effect.flatMap(query(filters), telemetry.stats),
			trace: input => telemetry.trace(input.id),
			traces: filters => Effect.flatMap(query(filters), telemetry.traces)
		})
	})
)
