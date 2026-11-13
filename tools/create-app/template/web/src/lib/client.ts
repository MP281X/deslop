import {AtomRpc} from 'effect/reactivity'

import {RpcStream} from '@deslop/runtime/shared/rpc'
import {addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {RpcContracts} from '#rpcs/contracts.ts'

addPageTelemetry('@deslop/template-app')

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/template-app/lib/client/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: layerPageProtocol
}) {}

export const nameAtom = RpcClient.query('app.name', undefined)
