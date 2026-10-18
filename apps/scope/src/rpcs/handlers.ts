import {Effect} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Telemetry} from '#services/telemetry/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const telemetry = yield* Telemetry
		return RpcContracts.of({
			'telemetry.logs': query => telemetry.logs(query),
			'telemetry.spans': query => telemetry.spans(query),
			'telemetry.stats': query => telemetry.stats(query),
			'telemetry.trace': id => telemetry.trace(id),
			'telemetry.traces': query => telemetry.traces(query),
			'telemetry.watch': () => telemetry.changes
		})
	})
)
