import {RpcAuth} from '@deslop/runtime/shared/auth'

import {ExposuresRpcs} from '#exposures/contract.ts'
import {InventoryRpcs} from '#inventory/contract.ts'
import {MetricsRpcs} from '#metrics/contract.ts'

export const RpcContracts = MetricsRpcs.merge(InventoryRpcs, ExposuresRpcs).middleware(RpcAuth)
