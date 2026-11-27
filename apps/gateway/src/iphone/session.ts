import {Boolean, Effect, Function} from 'effect'

import {AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, deleteItemAsync, getItemAsync, setItemAsync} from 'expo-secure-store'
import {openAuthSessionAsync} from 'expo-web-browser'
import {fetch} from 'expo/fetch'
import WebSocket from 'react-native/Libraries/WebSocket/WebSocket'

import {iphoneSession, isSignOutConfirmed, secureSession} from '@deslop/runtime/iphone/session'

import {appOrigin, authOrigin, scheme} from '#iphone/origin.ts'

const store = secureSession({deleteItemAsync, getItemAsync, setItemAsync}, AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY)
export const session = iphoneSession({appOrigin, authOrigin, scheme}, store, openAuthSessionAsync, WebSocket)

export const readIPhoneAccount = session.readIPhoneAccount(fetch)

export const signOutIPhone = Effect.map(session.signOut(fetch), status => ({
	changed: true,
	problem: Boolean.match(isSignOutConfirmed(status), {
		onFalse: Function.constant('Auth did not confirm ending the shared session.'),
		onTrue: Function.constUndefined
	})
}))
