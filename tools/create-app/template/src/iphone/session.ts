import {Command} from '@effect/ui'

import {Schema} from 'effect'

import {AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, deleteItemAsync, getItemAsync, setItemAsync} from 'expo-secure-store'
import {openAuthSessionAsync} from 'expo-web-browser'
import {fetch} from 'expo/fetch'
import WebSocket from 'react-native/Libraries/WebSocket/WebSocket'

import {iphoneSession, secureSession} from '@deslop/runtime/iphone/session'
import {AuthError} from '@deslop/runtime/shared/auth'

import {appOrigin, authOrigin, scheme} from '#iphone/origin.ts'

const store = secureSession({deleteItemAsync, getItemAsync, setItemAsync}, AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY)
export const session = iphoneSession({appOrigin, authOrigin, scheme}, store, openAuthSessionAsync, WebSocket)

export const readIPhoneAccount = session.readIPhoneAccount(fetch)

export class IPhoneSignIn extends Command.Service<IPhoneSignIn>()('App/IPhoneSignIn', {
	args: {},
	error: AuthError,
	success: Schema.Boolean
}) {
	static readonly layer = this.toLayer(() => session.signIn)
}
