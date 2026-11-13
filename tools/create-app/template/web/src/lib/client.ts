import {AtomRpc} from 'effect/reactivity'

import {RpcStream} from '@deslop/runtime/shared/rpc'
import {addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {RpcContracts} from '#rpcs/contracts.ts'

addPageTelemetry('@deslop/template-app')

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/template-app/lib/utils/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: layerPageProtocol
}) {}
