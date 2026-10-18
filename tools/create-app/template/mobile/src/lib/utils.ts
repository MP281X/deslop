import {AtomRpc} from 'effect/reactivity'

import * as MobileRuntime from '@deslop/runtime/mobile'

import {RpcContracts} from '#rpcs/contracts.ts'

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/template-app/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: MobileRuntime.layer('@deslop/template-app')(MobileRuntime.extra.server)
}) {}
