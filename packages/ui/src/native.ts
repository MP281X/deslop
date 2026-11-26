import {Cause, Deferred, Effect, Latch, Layer, MutableRef, Option, Predicate, Queue, Schema, pipe} from 'effect'

import {registerPlugin} from '@capacitor/core'
import type {PluginListenerHandle} from '@capacitor/core'
import {Socket} from 'effect/socket'

import {layerSocketProtocol} from '@deslop/runtime/client/protocol'
import {AuthError, outageUnlessRefused} from '@deslop/runtime/shared/auth'
import {Account} from '@deslop/runtime/shared/schema'

const SOCKET_IDS = MutableRef.make(0)

type SocketEventType = typeof SocketEventType.Type
const SocketEventType = Schema.Literals(['open', 'message', 'close', 'error'])

type SocketEvent = {
	readonly id: string
	readonly type: SocketEventType
	readonly data?: string
	readonly code?: number
	readonly message?: string
}

/* oxlint-disable typescript/no-restricted-types -- Capacitor's bridge returns Promises. */
const native = registerPlugin<{
	config: () => Promise<{bundle: string; server: string}>
	account: () => Promise<{status: number; body: string}>
	signIn: () => Promise<{signedIn: boolean}>
	signOut: () => Promise<{status: number}>
	addListener: (eventName: 'socket', listener: (event: SocketEvent) => void) => Promise<PluginListenerHandle>
	openSocket: (options: {id: string}) => Promise<void>
	sendSocket: (options: {id: string; data: string}) => Promise<void>
	closeSocket: (options: {id: string; code?: number}) => Promise<void>
}>('DeslopNative')

function authCall<A>(message: string, call: () => Promise<A>) {
	return Effect.tryPromise({
		catch: cause => AuthError.make({cause, error: 'temporarily_unavailable', message}),
		try: call
	})
}

function socketCall<A>(reason: (cause: unknown) => Socket.SocketError, call: () => Promise<A>) {
	return Effect.tryPromise({catch: reason, try: call})
}
/* oxlint-enable typescript/no-restricted-types */

const nativeConfig = authCall('This app has no server configured', () => native.config())
export const nativeServer = Effect.map(nativeConfig, config => config.server)
export const nativeBundle = Effect.map(nativeConfig, config => config.bundle)
export const nativeSignIn = Effect.map(
	authCall('Could not open Auth sign-in', () => native.signIn()),
	x => x.signedIn
)
export const nativeSignOut = Effect.map(
	authCall('Sign-out was incomplete', () => native.signOut()),
	x => x.status
)

export const nativeAccount = outageUnlessRefused('The server could not be reached')(
	Effect.gen(function* () {
		const response = yield* authCall('Could not read the account', () => native.account())
		if (response.status === 401) return yield* AuthError.make({message: 'Sign in first'})
		if (response.status === 403) {
			return yield* AuthError.make({error: 'access_denied', message: 'This account is refused'})
		}
		if (response.status !== 200) {
			return yield* AuthError.make({error: 'temporarily_unavailable', message: 'The server could not be reached'})
		}
		return yield* Schema.decodeEffect(Schema.fromJsonString(Account))(response.body)
	})
)

function openFailure(cause: unknown) {
	return Socket.SocketError.make({reason: Socket.SocketOpenError.make({cause, kind: 'Unknown'})})
}
function readFailure(cause: unknown) {
	return Socket.SocketError.make({reason: Socket.SocketReadError.make({cause})})
}
function writeFailure(cause: unknown) {
	return Socket.SocketError.make({reason: Socket.SocketWriteError.make({cause})})
}

function serialize(frame: Uint8Array | string) {
	if (Predicate.isString(frame)) return new TextEncoder().encode(frame)
	return frame
}

function receive(
	event: SocketEvent,
	ready: Deferred.Deferred<void, Socket.SocketError>,
	frames: Queue.Enqueue<Uint8Array, Socket.SocketError>
) {
	if (event.type === 'open') {
		Deferred.doneUnsafe(ready, Effect.void)
		return
	}
	if (event.type === 'message') {
		if (
			Option.exists(Schema.decodeUnknownOption(Schema.Uint8ArrayFromBase64)(event.data), frame =>
				Queue.offerUnsafe(frames, frame)
			)
		) {
			return
		}
	}
	if (event.type === 'close') {
		const closed = Socket.SocketError.make({reason: Socket.SocketCloseError.make({code: event.code ?? 1006})})
		Deferred.doneUnsafe(ready, Effect.fail(openFailure(closed)))
		Queue.failCauseUnsafe(frames, Cause.fail(closed))
		return
	}
	const failure = readFailure(event.message ?? 'The native socket could not deliver a frame')
	Deferred.doneUnsafe(ready, Effect.fail(openFailure(failure)))
	Queue.failCauseUnsafe(frames, Cause.fail(failure))
}

// Native I/O keeps the Keychain cookie out of the web view without changing Effect RPC framing.
const nativeSocket = Layer.effect(
	Socket.Socket,
	Effect.sync(() => {
		const open = Latch.makeUnsafe(false)
		const current = MutableRef.make(Option.none<string>())
		const reader = Effect.gen(function* () {
			const id = yield* Effect.sync(() => `rpc-${MutableRef.getAndIncrement(SOCKET_IDS)}`)
			const ready = yield* Deferred.make<void, Socket.SocketError>()
			const frames = yield* Queue.dropping<Uint8Array, Socket.SocketError>(256)
			yield* Effect.acquireRelease(
				socketCall(openFailure, () =>
					native.addListener('socket', event => {
						if (event.id === id) receive(event, ready, frames)
					})
				),
				listener =>
					pipe(
						socketCall(readFailure, () => native.closeSocket({id})),
						Effect.ignore({log: 'Warn'}),
						Effect.ensuring(
							Effect.andThen(
								Effect.sync(() => {
									if (!Option.exists(MutableRef.get(current), active => active === id)) return
									MutableRef.set(current, Option.none())
									open.closeUnsafe()
								}),
								Effect.ignore(
									socketCall(readFailure, () => listener.remove()),
									{log: 'Warn'}
								)
							)
						)
					)
			)
			yield* socketCall(openFailure, () => native.openSocket({id}))
			yield* Effect.timeoutOrElse(Deferred.await(ready), {
				duration: '10 seconds',
				orElse: () =>
					Effect.fail(
						Socket.SocketError.make({
							reason: Socket.SocketOpenError.make({cause: 'The native socket did not open', kind: 'Timeout'})
						})
					)
			})
			MutableRef.set(current, Option.some(id))
			open.openUnsafe()
			return {pull: Queue.takeAll(frames), upgrade: Socket.SocketUpgradeError.unsupported}
		})
		function write(chunk: Uint8Array | string | Socket.CloseEvent) {
			return open.whenOpen(
				Effect.suspend(() =>
					Option.match(MutableRef.get(current), {
						onNone: () => Effect.fail(writeFailure('The native socket closed')),
						onSome: id => {
							if (Socket.isCloseEvent(chunk)) {
								return socketCall(writeFailure, () => native.closeSocket({code: chunk.code, id}))
							}
							return pipe(
								Schema.encodeEffect(Schema.Uint8ArrayFromBase64)(serialize(chunk)),
								// oxlint-disable-next-line @deslop/coding-standards/recover-named-failures -- SocketError stores the original cause in its typed reason.
								Effect.mapError(cause => Socket.SocketError.make({reason: Socket.SocketWriteError.make({cause})})),
								Effect.flatMap(frame => socketCall(writeFailure, () => native.sendSocket({data: frame, id})))
							)
						}
					})
				)
			)
		}
		return Socket.make({
			reader,
			writer: Effect.succeed({
				write,
				writeAll: chunks => Effect.forEach(chunks, write, {concurrency: 1, discard: true})
			})
		})
	})
)

export const layerNativeProtocol = layerSocketProtocol(nativeSocket)
