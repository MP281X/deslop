import {Effect} from 'effect'

import type {Atom} from 'effect/reactivity'
import {AtomRpc} from 'effect/reactivity'

import {hues} from '@deslop/components-mobile/theme'
import {keychain} from '@deslop/runtime/mobile/keychain'
import * as MobileSession from '@deslop/runtime/mobile/session'
import {RpcStream} from '@deslop/runtime/rpc'

import {RpcContracts} from '#rpcs/contracts.ts'

export const SERVER = 'https://stash.mp281x.xyz'

export const primary = hues.amber

export const session = MobileSession.make(SERVER, keychain)

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/stash/lib/session/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: session.protocol
}) {}

// Actions read the client once rather than rerunning their last write when it reconnects.
export function withClient<A, E>(get: Atom.FnContext, effect: Effect.Effect<A, E, RpcClient>) {
	return Effect.flatMap(get.result(RpcClient.runtime), context => Effect.provideContext(effect, context))
}
