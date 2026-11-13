import {Effect} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Telemetry} from '#services/telemetry/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const telemetry = yield* Telemetry
		return RpcContracts.of({
			'telemetry.trace': input => telemetry.watchTrace(input.id),
			'telemetry.watch': range => telemetry.watch(range)
		})
	})
)
