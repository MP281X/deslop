import {Effect} from 'effect'

import {openAuthSessionAsync} from 'expo-web-browser'
import {fetch} from 'expo/fetch'
import WebSocket from 'react-native/Libraries/WebSocket/WebSocket'

import {iphoneSession, nativeSession} from '@deslop/runtime/iphone/session'

import {StashNative} from '#iphone/device.ts'
import {appOrigin, authOrigin, scheme} from '#iphone/origin.ts'

const store = nativeSession(StashNative)
export const session = iphoneSession({appOrigin, authOrigin, scheme}, store, openAuthSessionAsync, WebSocket)

export const readIPhoneAccount = session.readIPhoneAccount(fetch)

export const signOut = Effect.asVoid(session.signOut(fetch))
