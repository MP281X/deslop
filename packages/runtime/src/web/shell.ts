import {Effect, Layer} from 'effect'

import {Authenticate, OpenUrl, layerShell} from '#client/shell.ts'
import {accountAtom, addPageTelemetry, layerPageProtocol, pageSignIn} from '#web/client.ts'

// The page's part of the shell: the telemetry it sends to Scope, its account and socket, and the sign-in that leaves for Auth.
export function layerWebShell(name: string) {
	return Layer.unwrap(
		Effect.sync(() => {
			addPageTelemetry(`@deslop/${name}`)
			return Layer.mergeAll(
				layerShell(layerPageProtocol, accountAtom, true),
				Authenticate.toLayer(() => pageSignIn),
				OpenUrl.toLayer(() => Effect.void)
			)
		})
	)
}
