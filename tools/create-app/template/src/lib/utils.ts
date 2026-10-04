import {AtomRpc} from 'effect/reactivity'

import {RpcContracts} from '#rpcs/contracts.ts'
import * as ClientRuntime from '@deslop/runtime/client'

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/template-app/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: ClientRuntime.layer('@deslop/template-app')
}) {}
