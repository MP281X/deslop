import {Effect, Stream} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Presence} from '#services/presence/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const presence = yield* Presence
		return RpcContracts.of({
			'portfolio.join': input => Stream.onStart(presence.join(input), Effect.annotateCurrentSpan('rpc.stream', true)),
			'portfolio.move': presence.move
		})
	})
)
