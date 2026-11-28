import {RpcAuth} from '@deslop/runtime/shared/auth'

import {ChaptersRpcs} from '#chapters/contract.ts'
import {PushRpcs} from '#push/contract.ts'

export const RpcContracts = ChaptersRpcs.merge(PushRpcs).middleware(RpcAuth)
