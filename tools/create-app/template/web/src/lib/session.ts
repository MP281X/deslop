import {Effect} from 'effect'

import {signInUrl} from '@deslop/runtime/shared/auth'
import {accountAtom, addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

addPageTelemetry('@deslop/template-app')

export const session = {
	account: accountAtom,
	protocol: layerPageProtocol,
	signIn: Effect.sync(() => {
		location.replace(signInUrl(location.href))
		return false
	})
}
