import {AtomRpc} from 'effect/reactivity'

import {RpcStream} from '@deslop/runtime/shared/rpc'
import {addPageTelemetry} from '@deslop/runtime/web/client'

import {RpcContracts} from '#contracts'

import {clientProtocol, native} from '#web/platform.ts'

if (!native) addPageTelemetry('@deslop/opm')

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/opm/web/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: clientProtocol
}) {}
