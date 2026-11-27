import {AtomRpc} from 'effect/reactivity'

import {RpcStream} from '@deslop/runtime/shared/rpc'
import {addPageTelemetry} from '@deslop/runtime/web/client'
import {isNative, sessionProtocol} from '@deslop/ui/native'

import {RpcContracts} from '#contracts'

if (!isNative) addPageTelemetry('@deslop/opm')

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/opm/web/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: sessionProtocol
}) {}
