import {AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, deleteItemAsync, getItemAsync, setItemAsync} from 'expo-secure-store'
import {openAuthSessionAsync} from 'expo-web-browser'
import {fetch} from 'expo/fetch'
import WebSocket from 'react-native/Libraries/WebSocket/WebSocket'

import {iphoneSession, secureSession} from '@deslop/runtime/iphone/session'

import {appOrigin, authOrigin, scheme} from '#iphone/origin.ts'
import {Authenticate} from '#screens/reads.ts'

export const session = iphoneSession(
	{appOrigin, authOrigin, scheme},
	secureSession({deleteItemAsync, getItemAsync, setItemAsync}, AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY),
	openAuthSessionAsync,
	WebSocket
)

export const readIPhoneAccount = session.readIPhoneAccount(fetch)

export const layerIPhoneSignIn = Authenticate.toLayer(() => session.signIn)
