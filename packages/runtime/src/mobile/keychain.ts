import {Effect} from 'effect'

import {AFTER_FIRST_UNLOCK, deleteItemAsync, getItem, setItem} from 'expo-secure-store'

import type {SessionStorage} from '#mobile/session.ts'
import {AuthError} from '#shared/auth.ts'

// Outside session.ts: loading expo-secure-store crashes an app that does not build its native module.
export const keychain = {
	clear: Effect.tryPromise({
		catch: cause => AuthError.make({cause, message: 'The Keychain could not remove the session'}),
		try: () => deleteItemAsync('session')
	}),
	read: Effect.try({
		catch: cause => AuthError.make({cause, message: 'The Keychain could not read the session'}),
		try: () => getItem('session') ?? ''
	}),
	write: text =>
		Effect.try({
			catch: cause => AuthError.make({cause, message: 'The Keychain could not save the session'}),
			try: () => setItem('session', text, {keychainAccessible: AFTER_FIRST_UNLOCK})
		})
} satisfies SessionStorage
