import {Effect} from 'effect'

import {AtomRpc} from 'effect/reactivity'
import type {AsyncResult, Atom} from 'effect/reactivity'

import {keychain} from '@deslop/runtime/mobile/keychain'
import * as MobileSession from '@deslop/runtime/mobile/session'

import {RpcContracts} from '#rpcs/contracts.ts'

export const session = MobileSession.make('https://trips.mp281x.xyz', keychain)

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/trips/lib/session/RpcClient', {
	group: RpcContracts,
	protocol: session.protocol
}) {}

// Actions read the client once rather than rerunning their last write when it reconnects.
export function withClient<A, E>(
	get: {result: <B, X>(atom: Atom.Atom<AsyncResult.AsyncResult<B, X>>) => Effect.Effect<B, X>},
	effect: Effect.Effect<A, E, RpcClient>
) {
	return Effect.flatMap(get.result(RpcClient.runtime), context => Effect.provideContext(effect, context))
}
