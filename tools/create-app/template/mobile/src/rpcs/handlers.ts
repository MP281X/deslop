import {Effect} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'

export const RpcHandlers = RpcContracts.toLayer(
	RpcContracts.of({'app.name': () => Effect.succeed('@deslop/template-app')})
)
