import {Boolean} from 'effect'

import {Capacitor} from '@capacitor/core'
import {Atom, AtomRpc} from 'effect/reactivity'

import {RpcStream} from '@deslop/runtime/shared/rpc'
import {accountAtom as webAccount, addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'
import {layerNativeProtocol, nativeAccount} from '@deslop/ui/native'

import {RpcContracts} from '#rpcs/contracts.ts'

export const native = Capacitor.isNativePlatform()

if (!native) addPageTelemetry('@deslop/opm')

export const accountAtom = Boolean.match(native, {onFalse: () => webAccount, onTrue: () => Atom.make(nativeAccount)})

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/opm/lib/session/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: Boolean.match(native, {onFalse: () => layerPageProtocol, onTrue: () => layerNativeProtocol})
}) {}
