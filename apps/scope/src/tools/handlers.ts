import {Clock, Effect, Match, pipe} from 'effect'

import {queryOf} from '#services/telemetry/lib/utils.ts'
import {Telemetry} from '#services/telemetry/service.ts'
import {Tools} from '#tools/contracts.ts'

export const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const telemetry = yield* Telemetry
		return Tools.of({
			find: input =>
				Effect.flatMap(Clock.currentTimeMillis, now =>
					pipe(
						Match.value(input.kind),
						Match.when('traces', () => telemetry.traces(queryOf(input, now))),
						Match.when('spans', () => telemetry.spans(queryOf(input, now))),
						Match.when('logs', () => telemetry.logs(queryOf(input, now))),
						Match.exhaustive
					)
				),
			list_services: () => telemetry.services(),
			measure_latency: filters =>
				Effect.flatMap(Clock.currentTimeMillis, now => telemetry.stats(queryOf(filters, now))),
			read_trace: input => telemetry.trace(input.id)
		})
	})
)
