import {Effect} from 'effect'

import * as SecureStore from 'expo-secure-store'

import type {Storage} from '#mobile/session.ts'
import {AuthError} from '#shared/auth.ts'

// Outside session.ts: loading expo-secure-store crashes an app that does not build its native module.
export const keychain = {
	clear: Effect.tryPromise({
		catch: cause => AuthError.make({cause, message: 'The Keychain could not remove the session'}),
		try: () => SecureStore.deleteItemAsync('session')
	}),
	read: Effect.try({
		catch: cause => AuthError.make({cause, message: 'The Keychain could not read the session'}),
		try: () => SecureStore.getItem('session') ?? ''
	}),
	write: text =>
		Effect.try({
			catch: cause => AuthError.make({cause, message: 'The Keychain could not save the session'}),
			try: () => SecureStore.setItem('session', text, {keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK})
		})
} satisfies Storage
