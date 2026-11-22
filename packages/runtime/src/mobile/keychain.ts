import {Effect, Option, Schema, String, pipe} from 'effect'

import {AFTER_FIRST_UNLOCK, deleteItemAsync, getItem, setItem} from 'expo-secure-store'

import {AuthError, SESSION_COOKIE} from '#shared/auth.ts'
import {Account} from '#shared/schema.ts'

// The secret of the session Auth issued this device: in Stash and Trips the Keychain access group their share extension reads, in every other app the app's own.
const KEY = 'session'
const ACCOUNT_KEY = 'account'

const clearAccount = Effect.tryPromise({
	catch: cause => AuthError.make({cause, message: 'The Keychain could not remove the account'}),
	try: () => deleteItemAsync(ACCOUNT_KEY)
})

export const keychain = {
	account: () =>
		Option.flatMap(
			Option.liftThrowable(() => getItem(ACCOUNT_KEY))(),
			Schema.decodeUnknownOption(Schema.fromJsonString(Account))
		),
	clearAccount,
	clearSession: Effect.tryPromise({
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
	saveAccount: Effect.fnUntraced(function* (account: Account) {
		const value = yield* Schema.encodeEffect(Schema.fromJsonString(Account))(account)
		yield* Effect.try({
			catch: cause => AuthError.make({cause, message: 'The Keychain could not save the account'}),
			try: () => setItem(ACCOUNT_KEY, value, {keychainAccessible: AFTER_FIRST_UNLOCK})
		})
	}),
	write: (secret: string) =>
		Effect.try({
			catch: cause => AuthError.make({cause, message: 'The Keychain could not save the session'}),
			try: () => setItem(KEY, secret, {keychainAccessible: AFTER_FIRST_UNLOCK})
		})
}
