import {Boolean, Effect, Function} from 'effect'

import {signInUrl} from '@deslop/runtime/shared/auth'
import {addPageTelemetry} from '@deslop/runtime/web/client'
import {isNative, nativeSignIn, sessionAccount, sessionProtocol} from '@deslop/ui/native'

if (!isNative) addPageTelemetry('@deslop/template-app')

export const session = {
	account: sessionAccount,
	protocol: sessionProtocol,
	signIn: Boolean.match(isNative, {
		onFalse: () =>
			Effect.sync(() => {
				location.replace(signInUrl(location.href))
				return false
			}),
		onTrue: Function.constant(nativeSignIn)
	})
}
