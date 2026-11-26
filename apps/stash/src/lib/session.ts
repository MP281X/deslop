import {Boolean} from 'effect'

import {Capacitor} from '@capacitor/core'
import {Atom, AtomRpc} from 'effect/reactivity'

import {RpcStream} from '@deslop/runtime/shared/rpc'
import {accountAtom, addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'
import {layerNativeProtocol, nativeAccount} from '@deslop/ui/native'

import {RpcContracts} from '#rpcs/contracts.ts'

export const installed = Capacitor.isNativePlatform()
export const account = Boolean.match(installed, {onFalse: () => accountAtom, onTrue: () => Atom.make(nativeAccount)})

if (!installed) addPageTelemetry('@deslop/stash')

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/stash/lib/session/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: Boolean.match(installed, {onFalse: () => layerPageProtocol, onTrue: () => layerNativeProtocol})
}) {}
