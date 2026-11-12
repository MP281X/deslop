import {AtomRpc} from 'effect/reactivity'

import {hues} from '@deslop/components-mobile/theme'
import {keychain} from '@deslop/runtime/mobile/keychain'
import * as MobileSession from '@deslop/runtime/mobile/session'
import {RpcStream} from '@deslop/runtime/shared/rpc'

import {RpcContracts} from '#rpcs/contracts.ts'

export const primary = hues.orange

export const session = MobileSession.make('https://template-app.mp281x.xyz', keychain)

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/template-app/lib/utils/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: session.protocol
}) {}
