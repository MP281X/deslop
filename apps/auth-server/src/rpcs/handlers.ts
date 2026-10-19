import {CurrentUser} from '@deslop/auth/utils'

import {RpcContracts} from '#rpcs/contracts.ts'

export const RpcHandlers = RpcContracts.toLayer({'auth.me': () => CurrentUser})
