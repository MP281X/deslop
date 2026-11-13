import {AtomRpc} from 'effect/reactivity'

import {hues} from '@deslop/components-mobile/theme'
import {keychain} from '@deslop/runtime/mobile/keychain'
import {makeSession} from '@deslop/runtime/mobile/session'
import {RpcStream} from '@deslop/runtime/shared/rpc'

import {RpcContracts} from '#rpcs/contracts.ts'

export const SERVER = 'https://stash.mp281x.xyz'

export const primary = hues.amber

export const session = makeSession(SERVER, keychain)

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/stash/lib/session/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: session.protocol
}) {}
