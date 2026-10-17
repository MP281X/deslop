import {Effect, Layer, Option, Schema, String, pipe} from 'effect'

import {Atom} from 'effect/reactivity'
import * as Rpc from 'effect/rpc'
import {Socket} from 'effect/socket'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import {AppState} from 'react-native'

import {layerOtlp} from '#telemetry.ts'

export const extra = Schema.decodeUnknownSync(Schema.Struct({otel: Schema.String, server: Schema.String}))(
	Constants.expoConfig?.extra
)

// Binary frames failed to reopen a cancelled watch on iOS.
export function layer(applicationName: string) {
	Atom.runtime.addGlobalLayer(layerOtlp(`${applicationName}-ios`, extra.otel))
	return pipe(
		// The default ping timeout equals the 5-second ping interval, so any pong delay closes the socket.
		Rpc.RpcClient.layerProtocolSocket({pingTimeout: '15 seconds', retryTransientErrors: true}),
		Layer.provide(Socket.layerWebSocket(pipe(new URL('/api/rpc', extra.server).href, String.replace(/^http/u, 'ws')))),
		Layer.provide(Socket.layerWebSocketConstructorGlobal),
		Layer.provide(Rpc.RpcSerialization.layerJson)
	)
}

// iOS suspends sockets in the background, so atoms that read this count start over on each return to the app.
export const activationsAtom = Atom.make(get => {
	const subscription = AppState.addEventListener('change', state => {
		if (state === 'active') get.setSelf(Option.getOrElse(get.self<number>(), () => 0) + 1)
	})
	get.addFinalizer(() => subscription.remove())
	return 0
})

export const updateAtom = Atom.keepAlive(
	Atom.make(get =>
		pipe(
			Effect.gen(function* () {
				get(activationsAtom)
				if (!Updates.isEnabled) return
				if (!(yield* Effect.tryPromise(() => Updates.checkForUpdateAsync())).isAvailable) return
				if (!(yield* Effect.tryPromise(() => Updates.fetchUpdateAsync())).isNew) return
				yield* Effect.tryPromise(() => Updates.reloadAsync())
			}),
			Effect.ignore({log: 'Warn', message: 'The app update check failed'})
		)
	)
)
