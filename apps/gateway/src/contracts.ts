import {AiMeteringRpcs} from '#ai-metering/contract.ts'
import {AiProxyRpcs} from '#ai-proxy/contract.ts'
import {ConnectionsRpcs} from '#connections/contract.ts'

export const RpcContracts = AiProxyRpcs.merge(AiMeteringRpcs, ConnectionsRpcs)
