import {Effect} from 'effect'

import * as SecureStore from 'expo-secure-store'

import type {Storage} from '#mobile/session.ts'

// Outside session.ts: loading expo-secure-store crashes an app that does not build its native module, such as Stash.
export const keychain = {
	clear: Effect.tryPromise(() => SecureStore.deleteItemAsync('session')),
	read: Effect.try(() => SecureStore.getItem('session') ?? ''),
	write: text =>
		Effect.try(() => SecureStore.setItem('session', text, {keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK}))
} satisfies Storage
