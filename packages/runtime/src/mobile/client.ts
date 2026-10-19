import {Effect, Layer, Option, Schema, String, pipe} from 'effect'

import type {HttpClient} from 'effect/http'
import {Atom} from 'effect/reactivity'
import * as Rpc from 'effect/rpc'
import {Socket} from 'effect/socket'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import {AppState} from 'react-native'

import type {AuthError} from '@deslop/auth/schema'

import {layerOtlp} from '#telemetry.ts'

export const extra = Schema.decodeUnknownSync(Schema.Struct({otel: Schema.String, scheme: Schema.String}))(
	Constants.expoConfig?.extra
)

// Telemetry starts once; the socket is built per server. JSON frames, because binary ones failed to reopen a cancelled watch on iOS.
export function layer(
	applicationName: string,
	authorization?: Effect.Effect<string, AuthError, HttpClient.HttpClient>
) {
	Atom.runtime.addGlobalLayer(layerOtlp(`${applicationName}-ios`, extra.otel, 'mobile', authorization))
	return (server: string) =>
		pipe(
			// The default ping timeout equals the 5-second ping interval, so any pong delay closes the socket.
			Rpc.RpcClient.layerProtocolSocket({pingTimeout: '15 seconds', retryTransientErrors: true}),
			Layer.provide(Socket.layerWebSocket(pipe(new URL('/api/rpc', server).href, String.replace(/^http/u, 'ws')))),
			Layer.provide(Socket.layerWebSocketConstructorGlobal),
			Layer.provide(Rpc.RpcSerialization.layerJson)
		)
}

// iOS suspends sockets in the background, so atoms that read this count start over on each return from it; a sign-in sheet only makes the app inactive.
export const activationsAtom = Atom.make(get => {
	const left = {background: false}
	const subscription = AppState.addEventListener('change', state => {
		if (state === 'background') left.background = true
		if (state !== 'active' || !left.background) return
		left.background = false
		get.setSelf(Option.getOrElse(get.self<number>(), () => 0) + 1)
	})
	get.addFinalizer(() => subscription.remove())
	return 0
})

const downloadedAtom = Atom.keepAlive(Atom.make(false))

// A reload ends what the user is doing, so a downloaded update starts on the next return to the app, before anything else; mount it only where a reload loses nothing.
export const updateAtom = Atom.make(get =>
	pipe(
		Effect.gen(function* () {
			get(activationsAtom)
			if (!Updates.isEnabled) return
			if (get.once(downloadedAtom)) return yield* Effect.tryPromise(() => Updates.reloadAsync())
			if (!(yield* Effect.tryPromise(() => Updates.checkForUpdateAsync())).isAvailable) return
			if (!(yield* Effect.tryPromise(() => Updates.fetchUpdateAsync())).isNew) return
			get.set(downloadedAtom, true)
		}),
		Effect.ignore({log: 'Warn', message: 'The app update check failed'})
	)
)
