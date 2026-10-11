import {AtomRpc} from 'effect/reactivity'

import {RpcContracts} from '#rpcs/contracts.ts'
import * as WebRuntime from '@deslop/runtime/web'

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/portfolio/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer('@deslop/portfolio')
}) {}
