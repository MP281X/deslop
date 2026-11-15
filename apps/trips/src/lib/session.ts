import {AtomRpc} from 'effect/reactivity'

import {hues} from '@deslop/components-mobile/theme'
import {makeSession} from '@deslop/runtime/mobile/session'
import {RpcStream} from '@deslop/runtime/shared/rpc'

import {RpcContracts} from '#rpcs/contracts.ts'

export const primary = hues.orange

export const session = makeSession('https://trips.mp281x.xyz')

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/trips/lib/session/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: session.protocol
}) {}
