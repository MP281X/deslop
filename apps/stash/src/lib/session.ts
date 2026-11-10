import {Effect} from 'effect'

import type {Atom} from 'effect/reactivity'
import {AtomRpc} from 'effect/reactivity'

import {hues} from '@deslop/components-mobile/theme'
import {AuthError} from '@deslop/runtime/auth/schema'
import * as MobileSession from '@deslop/runtime/mobile/session'

import {native} from '#modules/native/index.ts'
import {RpcContracts} from '#rpcs/contracts.ts'

export const SERVER = 'https://stash.mp281x.xyz'

export const primary = hues.amber

// The share extension shares this Keychain item.
export const session = MobileSession.make(SERVER, {
	clear: Effect.try({
		catch: cause => AuthError.make({cause, message: 'The Keychain could not remove the session'}),
		try: () => native.clearSession()
	}),
	read: Effect.try({
		catch: cause => AuthError.make({cause, message: 'The Keychain could not read the session'}),
		try: () => native.getSession()
	}),
	write: text =>
		Effect.try({
			catch: cause => AuthError.make({cause, message: 'The Keychain could not save the session'}),
			try: () => native.setSession(text)
		})
})

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/stash/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: session.protocol
}) {}

// Actions read the client once rather than rerunning their last write when it reconnects.
export function withClient<A, E>(get: Atom.FnContext, effect: Effect.Effect<A, E, RpcClient>) {
	return Effect.flatMap(get.result(RpcClient.runtime), context => Effect.provideContext(effect, context))
}
