import {Effect, Option, String, pipe} from 'effect'

import {AFTER_FIRST_UNLOCK, deleteItemAsync, getItem, setItem} from 'expo-secure-store'

import {AuthError, SESSION_COOKIE} from '#shared/auth.ts'

// The secret of the session Auth issued this device: in Stash the Keychain access group its share extension reads, in every other app the app's own.
const KEY = 'session'

export const keychain = {
	clear: Effect.tryPromise({
		catch: cause => AuthError.make({cause, message: 'The Keychain could not remove the session'}),
		try: () => deleteItemAsync(KEY)
	}),
	// What Auth reads to name the caller; a tailnet device needs no session, so nothing saved means no header.
	headers: () =>
		pipe(
			getItem(KEY),
			Option.fromNullishOr,
			Option.filter(String.isNonEmpty),
			Option.match({onNone: () => ({}), onSome: secret => ({cookie: `${SESSION_COOKIE}=${secret}`})})
		),
	write: (secret: string) =>
		Effect.try({
			catch: cause => AuthError.make({cause, message: 'The Keychain could not save the session'}),
			try: () => setItem(KEY, secret, {keychainAccessible: AFTER_FIRST_UNLOCK})
		})
}
