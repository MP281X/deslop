import {Effect, Layer, Result, Schema, String, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {Socket} from 'effect/socket'
import {AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, deleteItemAsync, getItemAsync, setItemAsync} from 'expo-secure-store'
import {openAuthSessionAsync} from 'expo-web-browser'
import {fetch} from 'expo/fetch'
import WebSocket from 'react-native/Libraries/WebSocket/WebSocket'

import {readAccount} from '@deslop/runtime/client/account'
import {AuthError, SESSION_COOKIE} from '@deslop/runtime/shared/auth'
import {RPC_PATH} from '@deslop/runtime/shared/schema'

import {appOrigin, authOrigin, scheme} from '#iphone/origin.ts'

const KEY = 'auth.session'
type Session = typeof Session.Type
const Session = Schema.String.check(Schema.isPattern(/^[\w-]{43}$/u))
const storeOptions = {keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY}
const sessionHeaders = Effect.map(
	Effect.tryPromise({
		catch: cause => AuthError.make({cause, error: 'temporarily_unavailable', message: 'Could not read the session'}),
		try: () => getItemAsync(KEY, storeOptions)
	}),
	value => {
		if (!String.startsWith('https://')(appOrigin) || !Schema.is(Session)(value)) return {}
		return {cookie: `${SESSION_COOKIE}=${value}`}
	}
)

export const readIPhoneAccount = pipe(
	sessionHeaders,
	Effect.flatMap(headers => readAccount(appOrigin, headers)),
	Effect.provideService(FetchHttpClient.Fetch, fetch),
	Effect.provideService(FetchHttpClient.RequestInit, {credentials: 'omit', redirect: 'error'})
)

const socketUrl = `${String.replace(/^http/u, 'ws')(appOrigin)}${RPC_PATH}`
function socketOpenError(cause: unknown) {
	return Socket.SocketError.make({reason: Socket.SocketOpenError.make({cause, kind: 'Unknown'})})
}

export const layerIPhoneSocket = Layer.effect(
	Socket.Socket,
	Socket.fromWebSocket(
		Effect.acquireRelease(
			Effect.mapBoth(sessionHeaders, {
				// oxlint-disable-next-line @deslop/coding-standards/recover-named-failures -- SocketError carries the original cause inside its typed reason.
				onFailure: socketOpenError,
				onSuccess: headers => new WebSocket(socketUrl, [], {headers})
			}),
			socket => Effect.sync(() => socket.close(1000))
		)
	)
)

const callback = `${authOrigin}/signed-in/${scheme}`
const start = `${authOrigin}/sign-in?${new URLSearchParams({app: scheme})}`
function signInFailure(cause: unknown) {
	return AuthError.make({cause, error: 'temporarily_unavailable', message: 'GitHub sign-in could not finish'})
}

// Accept the session only from Auth's own HTTPS result, never from an app deep link.
export const signInIPhone = Effect.gen(function* () {
	if (!String.startsWith('https://')(authOrigin)) return yield* signInFailure('Auth requires HTTPS')
	const result = yield* Effect.tryPromise({
		catch: signInFailure,
		try: () => openAuthSessionAsync(start, callback, {preferUniversalLinks: true})
	})
	if (result.type !== 'success') return false
	if (!String.startsWith(`${callback}?`)(result.url)) return yield* signInFailure('Unexpected Auth callback')
	const query = new URLSearchParams(String.slice(callback.length + 1)(result.url))
	const refusal = query.get('error')
	if (refusal !== null) return yield* AuthError.make({message: refusal})
	const secret = query.get('session')
	if (!Schema.is(Session)(secret)) return yield* signInFailure('Auth did not return a session')
	yield* Effect.tryPromise({catch: signInFailure, try: () => setItemAsync(KEY, secret, storeOptions)})
	return true
})

const endSharedSession = Effect.gen(function* () {
	if (!String.startsWith('https://')(authOrigin)) return yield* signInFailure('Auth requires HTTPS')
	const headers = yield* sessionHeaders
	return yield* Effect.tryPromise({
		catch: cause => AuthError.make({cause, message: 'Sign-out was incomplete'}),
		try: signal =>
			fetch(`${authOrigin}/sign-out`, {
				credentials: 'omit',
				headers: {...headers, origin: authOrigin},
				method: 'POST',
				redirect: 'manual',
				signal
			})
	})
})

// Even an unreachable Auth must not leave the device's copy signed in.
export const signOutIPhone = Effect.gen(function* () {
	const result = yield* Effect.result(Effect.timeout(endSharedSession, '10 seconds'))
	yield* Effect.tryPromise({
		catch: cause => AuthError.make({cause, message: 'Could not clear the device session'}),
		try: () => deleteItemAsync(KEY, storeOptions)
	})
	const confirmed = Result.isSuccess(result) && result.success.status >= 200 && result.success.status < 400
	return {changed: true, problem: confirmed ? undefined : 'Auth did not confirm ending the shared session.'}
})
