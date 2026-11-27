import {Array, Effect, Option, Result, Schema, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {AsyncResult, Atom, AtomRegistry} from 'effect/reactivity'
import {AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, deleteItemAsync, getItemAsync, setItemAsync} from 'expo-secure-store'
import {openAuthSessionAsync} from 'expo-web-browser'
import {fetch} from 'expo/fetch'
import WebSocket from 'react-native/Libraries/WebSocket/WebSocket'

import {iphoneSession, secureSession} from '@deslop/runtime/iphone/session'
import type {AuthError} from '@deslop/runtime/shared/auth'
import {isDenied} from '@deslop/runtime/shared/auth'
import {Account} from '@deslop/runtime/shared/schema'

import {appOrigin, authOrigin, keychainGroup, sessionKey, sessionService} from '#iphone/origin.ts'
import {accountCache, flightCache} from '#iphone/store.ts'

const store = secureSession(
	{deleteItemAsync, getItemAsync, setItemAsync},
	AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
	sessionKey,
	{accessGroup: keychainGroup, keychainService: sessionService}
)
export const session = iphoneSession({appOrigin, authOrigin, scheme: 'trips'}, store, openAuthSessionAsync, WebSocket)

const readIPhoneAccount = session.readIPhoneAccount(fetch)

type AccountText = typeof AccountText.Type
const AccountText = Schema.fromJsonString(Account)
const cachedAccountAtom = Atom.keepAlive(
	Atom.make(Effect.map(accountCache.read, Option.flatMap(Schema.decodeOption(AccountText))))
)
const clearCache = Effect.andThen(accountCache.clear, flightCache.clear)
const accountRuntime = Atom.runtime(FetchHttpClient.layer)
const signingOutAtom = Atom.make(false)
const checkedAccountAtom = accountRuntime.atom(get =>
	pipe(
		readIPhoneAccount,
		Effect.tap(account =>
			pipe(
				Schema.encodeEffect(AccountText)(account),
				Effect.flatMap(accountCache.write),
				Effect.ignore({log: 'Warn', message: 'The offline account could not be saved'}),
				Effect.andThen(Effect.sync(() => get.registry.refresh(cachedAccountAtom)))
			)
		),
		Effect.tapError(error => {
			if (!isDenied(error)) return Effect.void
			return Effect.andThen(
				clearCache,
				Effect.sync(() => get.registry.refresh(cachedAccountAtom))
			)
		})
	)
)

export const iPhoneAccountAtom = Atom.make(get => {
	const result = get(checkedAccountAtom)
	if (get(signingOutAtom)) return AsyncResult.initial<Account, AuthError>()
	if (AsyncResult.isSuccess(result)) return result
	if (Option.exists(AsyncResult.error(result), isDenied)) return result
	return Option.match(AsyncResult.value(get(cachedAccountAtom)), {
		onNone: () => result,
		onSome: snapshot => Option.match(snapshot, {onNone: () => result, onSome: user => AsyncResult.success(user)})
	})
})

export function refreshAccount(registry: AtomRegistry.AtomRegistry) {
	registry.refresh(checkedAccountAtom)
}

export function signOut(registry: AtomRegistry.AtomRegistry) {
	return Effect.gen(function* () {
		const status = yield* session.signOut(fetch)
		const wiped = yield* Effect.all([accountCache.remove, flightCache.remove], {
			concurrency: 'unbounded',
			mode: 'result'
		})
		registry.refresh(cachedAccountAtom)
		registry.set(signingOutAtom, true)
		yield* Effect.ensuring(
			pipe(
				Effect.sync(() => registry.refresh(checkedAccountAtom)),
				Effect.andThen(AtomRegistry.getResult(registry, checkedAccountAtom, {suspendOnWaiting: true})),
				Effect.ignore({log: 'Warn', message: 'Trips could not refresh its account after sign-out'})
			),
			Effect.sync(() => registry.set(signingOutAtom, false))
		)
		if (Array.some(wiped, Result.isFailure)) {
			return 'Signed out on this iPhone, but Trips could not clear its offline data.'
		}
		if (status === 303 || (status >= 200 && status < 300)) return undefined
		return 'Signed out on this iPhone. Auth did not confirm signing out elsewhere.'
	})
}
