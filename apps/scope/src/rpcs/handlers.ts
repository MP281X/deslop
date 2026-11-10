import {Effect} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Telemetry} from '#services/telemetry/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const telemetry = yield* Telemetry
		return RpcContracts.of({
			'scope.overview': range => telemetry.overview(range),
			'scope.trace': input => telemetry.trace(input.id)
		})
	})
)
