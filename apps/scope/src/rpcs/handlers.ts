import {Clock, Effect} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {queryOf} from '#services/telemetry/lib/utils.ts'
import {Telemetry} from '#services/telemetry/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const telemetry = yield* Telemetry
		return RpcContracts.of({
			'scope.services': () => telemetry.services(),
			'scope.trace': input => telemetry.trace(input.id),
			'scope.traces': input => Effect.flatMap(Clock.currentTimeMillis, now => telemetry.traces(queryOf(input, now)))
		})
	})
)
