import {Boolean, Effect, Stream} from 'effect'

import {Capacitor} from '@capacitor/core'
import type {PluginListenerHandle} from '@capacitor/core'
import {Atom} from 'effect/reactivity'

import {accountAtom as webAccount, layerPageProtocol} from '@deslop/runtime/web/client'
import {layerNativeProtocol, nativeAccount} from '@deslop/ui/native'

export const native = Capacitor.isNativePlatform()
export const accountAtom = Boolean.match(native, {onFalse: () => webAccount, onTrue: () => Atom.make(nativeAccount)})
export const clientProtocol = Boolean.match(native, {
	onFalse: () => layerPageProtocol,
	onTrue: () => layerNativeProtocol
})

export function listenNative<E>(attach: () => PromiseLike<PluginListenerHandle>, failure: (cause: unknown) => E) {
	return Effect.acquireRelease(Effect.tryPromise({catch: failure, try: attach}), listener =>
		Effect.ignore(Effect.tryPromise({catch: failure, try: () => listener.remove()}), {log: 'Warn'})
	)
}

export function registerTokens<E, E2, R, R2>(
	tokens: Stream.Stream<string, E, R>,
	register: (token: string) => Effect.Effect<void, E2, R2>
) {
	return Stream.switchMap(Stream.changes(tokens), token => Stream.fromEffectDrain(register(token)))
}
