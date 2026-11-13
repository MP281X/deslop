import {AtomRpc} from 'effect/reactivity'

import {keychain} from '@deslop/runtime/mobile/keychain'
import {makeSession} from '@deslop/runtime/mobile/session'
import {RpcStream} from '@deslop/runtime/shared/rpc'

import {RpcContracts} from '#rpcs/contracts.ts'

export const session = makeSession('https://trips.mp281x.xyz', keychain)

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/trips/lib/session/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: session.protocol
}) {}
