import {Effect} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Presence} from '#services/presence/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const presence = yield* Presence
		return RpcContracts.of({'portfolio.join': presence.join, 'portfolio.move': presence.move})
	})
)
