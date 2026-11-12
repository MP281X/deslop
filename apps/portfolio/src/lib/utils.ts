import {AtomRpc} from 'effect/reactivity'

import {RpcStream} from '@deslop/runtime/shared/rpc'
import * as WebRuntime from '@deslop/runtime/web/client'

import {RpcContracts} from '#rpcs/contracts.ts'

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/portfolio/lib/utils/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: WebRuntime.layer('@deslop/portfolio')
}) {}
