import {AtomRpc} from 'effect/reactivity'

import {RpcStream} from '@deslop/runtime/rpc'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/portfolio/lib/utils/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: WebRuntime.layer('@deslop/portfolio')
}) {}
