import {Effect} from 'effect'

import {AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, deleteItemAsync, getItemAsync, setItemAsync} from 'expo-secure-store'
import {openAuthSessionAsync} from 'expo-web-browser'
import {fetch} from 'expo/fetch'
import WebSocket from 'react-native/Libraries/WebSocket/WebSocket'

import {iphoneSession, secureSession} from '@deslop/runtime/iphone/session'
import {AuthError} from '@deslop/runtime/shared/auth'

import {appOrigin, scheme} from '#iphone/origin.ts'

const store = secureSession({deleteItemAsync, getItemAsync, setItemAsync}, AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY)
export const session = iphoneSession({appOrigin, authOrigin: appOrigin, scheme}, store, openAuthSessionAsync, WebSocket)

export const signOut = Effect.asVoid(
	Effect.mapError(session.signOut(fetch), cause => AuthError.make({cause, message: 'Couldn’t sign out'}))
)
