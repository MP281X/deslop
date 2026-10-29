import {Boolean, DateTime, Duration, Effect, Layer, Option, Schema, String, pipe} from 'effect'

import {Event, Machine, State} from 'effect-machine'
import type {HttpClient} from 'effect/http'
import {Atom} from 'effect/reactivity'
import {RpcClient, RpcSerialization} from 'effect/rpc'
import {Socket} from 'effect/socket'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import {AppState} from 'react-native'

import {actorAtom} from '#machine.ts'
import {layerOtlp} from '#telemetry.ts'

import type {AuthError} from '#auth/schema.ts'

// The public receiver; Scope's private port is out of a phone's reach.
export const TELEMETRY = 'https://otel.mp281x.xyz'

export const extra = Schema.decodeUnknownSync(Schema.Struct({scheme: Schema.String}))(Constants.expoConfig?.extra)

// Telemetry starts once; the socket is built per server. JSON frames, because binary ones failed to reopen a cancelled watch on iOS.
export function layer(
	applicationName: string,
	authorization?: Effect.Effect<string, AuthError, HttpClient.HttpClient>
) {
	Atom.runtime.addGlobalLayer(layerOtlp(`${applicationName}-ios`, TELEMETRY, 'mobile', authorization))
	return (server: string) =>
		pipe(
			// The default ping timeout equals the 5-second ping interval, so any pong delay closes the socket.
			RpcClient.layerProtocolSocket({pingTimeout: '15 seconds', retryTransientErrors: true}),
			Layer.provide(Socket.layerWebSocket(pipe(new URL('/api/rpc', server).href, String.replace(/^http/u, 'ws')))),
			Layer.provide(Socket.layerWebSocketConstructorGlobal),
			Layer.provide(RpcSerialization.layerJson)
		)
}

// How long the app spent in the background before its latest return, in milliseconds.
const awayAtom = Atom.keepAlive(Atom.make(0))

// iOS suspends sockets in the background, so atoms that read this count start over on each return from it; a sign-in sheet only makes the app inactive.
export const activationsAtom = Atom.make(get => {
	const left = {at: 0, background: false}
	const subscription = AppState.addEventListener('change', state => {
		if (state === 'background') {
			left.at = DateTime.toEpochMillis(DateTime.nowUnsafe())
			left.background = true
		}
		if (state !== 'active' || !left.background) return
		left.background = false
		get.set(awayAtom, DateTime.toEpochMillis(DateTime.nowUnsafe()) - left.at)
		get.setSelf(Option.getOrElse(get.self<number>(), () => 0) + 1)
	})
	get.addFinalizer(() => subscription.remove())
	return 0
})

const Update = State({Checking: {}, Downloaded: {}, Idle: {}, Reloading: {}})
const UpdateEvent = Event({Fetched: {}, Returned: {away: Schema.Finite}, Settled: {}})

// A reload looks like a crash to someone switching apps for a moment, so a downloaded update starts on the next launch or on a return after ten minutes away.
const updatesAtom = actorAtom(
	Machine.make({event: UpdateEvent, initial: Update.Idle, state: Update})
		.on(Update.Idle, UpdateEvent.Returned, () => Update.Checking)
		.task(
			Update.Checking,
			() =>
				pipe(
					Effect.gen(function* () {
						if (!(yield* Effect.tryPromise(() => Updates.checkForUpdateAsync())).isAvailable) return false
						return (yield* Effect.tryPromise(() => Updates.fetchUpdateAsync())).isNew
					}),
					Effect.tapError(error => Effect.logWarning('The app update check failed', error))
				),
			{
				onFailure: () => UpdateEvent.Settled,
				onSuccess: fetched =>
					Boolean.match(fetched, {onFalse: () => UpdateEvent.Settled, onTrue: () => UpdateEvent.Fetched})
			}
		)
		.on(Update.Checking, UpdateEvent.Fetched, () => Update.Downloaded)
		.on(Update.Checking, UpdateEvent.Settled, () => Update.Idle)
		.when(
			Update.Downloaded,
			UpdateEvent.Returned,
			transition => transition.event.away >= Duration.toMillis(Duration.minutes(10)),
			() => Update.Reloading
		)
		.task(
			Update.Reloading,
			() =>
				Effect.ignore(
					Effect.tryPromise(() => Updates.reloadAsync()),
					{log: 'Warn', message: 'The app update did not start'}
				),
			{onSuccess: () => UpdateEvent.Settled}
		)
		.on(Update.Reloading, UpdateEvent.Settled, () => Update.Downloaded)
)

// Checks on launch and on each return from the background; mount it only where a reload loses nothing.
export const updateAtom = Atom.make(get => {
	get(activationsAtom)
	if (Updates.isEnabled) get.set(updatesAtom, UpdateEvent.Returned({away: get.once(awayAtom)}))
})
