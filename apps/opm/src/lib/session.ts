import {AtomRpc} from 'effect/reactivity'

import {hues} from '@deslop/components-mobile/theme'
import {keychain} from '@deslop/runtime/mobile/keychain'
import {makeSession} from '@deslop/runtime/mobile/session'
import {RpcStream} from '@deslop/runtime/shared/rpc'

import {RpcContracts} from '#rpcs/contracts.ts'

export const primary = hues.ivory

export const session = makeSession('https://opm.mp281x.xyz', keychain)

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/opm/lib/session/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: session.protocol
}) {}
