import {AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, deleteItemAsync, getItemAsync, setItemAsync} from 'expo-secure-store'
import {openAuthSessionAsync} from 'expo-web-browser'
import {fetch} from 'expo/fetch'
import WebSocket from 'react-native/Libraries/WebSocket/WebSocket'

import {iphoneSession, secureSession} from '@deslop/runtime/iphone/session'

import {appOrigin, authOrigin} from '#iphone/origin.ts'

const store = secureSession({deleteItemAsync, getItemAsync, setItemAsync}, AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY)
export const session = iphoneSession({appOrigin, authOrigin, scheme: 'opm'}, store, openAuthSessionAsync, WebSocket)

export const readIPhoneAccount = session.readIPhoneAccount(fetch)

export const signOut = session.signOut(fetch)
