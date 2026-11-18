import {AtomRpc} from 'effect/reactivity'

import {makeSession} from '@deslop/runtime/mobile/session'
import {RpcStream} from '@deslop/runtime/shared/rpc'

import {RpcContracts} from '#rpcs/contracts.ts'

export const session = makeSession()

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/template-app/lib/session/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: session.protocol
}) {}

export const nameAtom = RpcClient.query('app.name', undefined)
