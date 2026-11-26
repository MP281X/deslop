import {Boolean, Effect} from 'effect'

import {Capacitor} from '@capacitor/core'
import {Atom} from 'effect/reactivity'

import {signInUrl} from '@deslop/runtime/shared/auth'
import {accountAtom, addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'
import {layerNativeProtocol, nativeAccount, nativeSignIn} from '@deslop/ui/native'

export const session = Boolean.match(Capacitor.isNativePlatform(), {
	onFalse: () => {
		addPageTelemetry('@deslop/template-app')
		return {
			account: accountAtom,
			protocol: layerPageProtocol,
			signIn: Effect.sync(() => {
				location.replace(signInUrl(location.href))
				return false
			})
		}
	},
	onTrue: () => ({
		account: Atom.make(nativeAccount),
		protocol: layerNativeProtocol,
		signIn: Effect.map(nativeSignIn, result => result.signedIn)
	})
})
