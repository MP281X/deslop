import {Effect} from 'effect'

import {RpcContracts} from '#contracts'

export const RpcHandlers = RpcContracts.toLayer({'app.name': () => Effect.succeed('@deslop/template-app')})
