import {RpcAdmin} from '@deslop/runtime/shared/auth'

import {ItemsRpcs} from '#items/contract.ts'

// Admin-only until the runtime probe's access list names a member API.
export const RpcContracts = ItemsRpcs.middleware(RpcAdmin)
