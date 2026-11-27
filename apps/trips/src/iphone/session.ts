import {Effect, Layer, Option, Schema, String, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {AsyncResult, Atom} from 'effect/reactivity'
import type {AtomRegistry} from 'effect/reactivity'
import {Socket} from 'effect/socket'
import {AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, deleteItemAsync, getItemAsync, setItemAsync} from 'expo-secure-store'
import {openAuthSessionAsync} from 'expo-web-browser'
import {fetch} from 'expo/fetch'
import WebSocket from 'react-native/Libraries/WebSocket/WebSocket'

import {readAccount} from '@deslop/runtime/client/account'
import {AuthError, SESSION_COOKIE, isDenied} from '@deslop/runtime/shared/auth'
import {Account, RPC_PATH} from '@deslop/runtime/shared/schema'

import {appOrigin, authOrigin, keychainGroup, sessionKey, sessionService} from '#iphone/origin.ts'
import {accountCache, flightCache} from '#iphone/store.ts'

type Session = typeof Session.Type
const Session = Schema.String.check(Schema.isPattern(/^[\w-]{43}$/u))
const storeOptions = {
	accessGroup: keychainGroup,
	keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
	keychainService: sessionService
}
const sessionHeaders = Effect.map(
	Effect.tryPromise({
		catch: cause => AuthError.make({cause, error: 'temporarily_unavailable', message: 'Could not read the session'}),
		try: () => getItemAsync(sessionKey, storeOptions)
	}),
	value => {
		if (!String.startsWith('https://')(appOrigin) || !Schema.is(Session)(value)) return {}
		return {cookie: `${SESSION_COOKIE}=${value}`}
	}
)

const readIPhoneAccount = pipe(
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

const authSlug = 'trips'
const callback = `${authOrigin}/signed-in/${authSlug}`
const start = `${authOrigin}/sign-in?${new URLSearchParams({app: authSlug})}`
function signInFailure(cause: unknown) {
	return AuthError.make({cause, error: 'temporarily_unavailable', message: 'GitHub sign-in could not finish'})
}

// Accept the session only from Auth's own HTTPS result, never from an app deep link.
export const signIn = Effect.gen(function* () {
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
	yield* Effect.tryPromise({catch: signInFailure, try: () => setItemAsync(sessionKey, secret, storeOptions)})
	return true
})

const AccountText = Schema.fromJsonString(Account)
const cached = Atom.keepAlive(
	Atom.make(pipe(accountCache.read, Effect.map(Option.flatMap(Schema.decodeOption(AccountText)))))
)
const readAccountOnPhone = pipe(readIPhoneAccount, Effect.provide(FetchHttpClient.layer))
const signingOut = Atom.make(false)
const checked = Atom.make(get =>
	pipe(
		readAccountOnPhone,
		Effect.tap(account =>
			pipe(
				Schema.encodeEffect(AccountText)(account),
				Effect.flatMap(accountCache.write),
				Effect.ignore({log: 'Warn', message: 'The offline account could not be saved'}),
				Effect.andThen(Effect.sync(() => get.registry.refresh(cached)))
			)
		),
		Effect.tapError(error => {
			if (!isDenied(error)) return Effect.void
			return Effect.andThen(
				clearCache,
				Effect.sync(() => get.registry.refresh(cached))
			)
		})
	)
)

const clearCache = Effect.andThen(accountCache.clear, flightCache.clear)
export const account = Atom.make(get => {
	const result = get(checked)
	if (get(signingOut)) return AsyncResult.initial<Account, AuthError>()
	if (AsyncResult.isSuccess(result)) return result
	if (Option.exists(AsyncResult.error(result), isDenied)) return result
	return Option.match(AsyncResult.value(get(cached)), {
		onNone: () => result,
		onSome: snapshot => Option.match(snapshot, {onNone: () => result, onSome: user => AsyncResult.success(user)})
	})
})

export function refreshAccount(registry: AtomRegistry.AtomRegistry) {
	registry.refresh(checked)
}

export function signOut(registry: AtomRegistry.AtomRegistry) {
	return Effect.gen(function* () {
		const headers = yield* sessionHeaders
		const response = yield* Effect.option(
			Effect.tryPromise({
				catch: signInFailure,
				try: signal =>
					fetch(`${authOrigin}/sign-out`, {
						credentials: 'omit',
						headers: {...headers, origin: authOrigin},
						method: 'POST',
						redirect: 'manual',
						signal
					})
			})
		)
		yield* Effect.tryPromise({
			catch: cause =>
				AuthError.make({
					cause,
					error: 'temporarily_unavailable',
					message: 'The local Auth session could not be cleared'
				}),
			try: () => deleteItemAsync(sessionKey, storeOptions)
		})
		yield* clearCache
		registry.refresh(cached)
		registry.set(signingOut, true)
		yield* Effect.ensuring(
			Effect.andThen(
				Effect.sync(() => registry.refresh(checked)),
				Effect.asVoid(AtomRegistry.getResult(registry, checked, {suspendOnWaiting: true}))
			).pipe(Effect.ignore({log: 'Warn', message: 'Trips could not refresh its account after sign-out'})),
			Effect.sync(() => registry.set(signingOut, false))
		)
		if (Option.exists(response, answer => answer.status === 303 || answer.ok)) return undefined
		return 'Signed out on this iPhone. Auth did not confirm signing out elsewhere.'
	})
}
