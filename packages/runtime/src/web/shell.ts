import {Effect, Layer} from 'effect'

import {Authenticate, OpenUrl, layerShell} from '#client/shell.ts'
import {accountAtom, addPageTelemetry, layerPageProtocol, pageSignIn} from '#web/client.ts'

// The page's part of the shell: the telemetry it sends to Scope unless `telemetry` is off, its account and socket, and the sign-in that leaves for Auth.
export function layerWebShell(name: string, options: {readonly telemetry?: false} = {}) {
	return Layer.unwrap(
		Effect.sync(() => {
			if (options.telemetry !== false) addPageTelemetry(`@deslop/${name}`)
			return Layer.mergeAll(
				layerShell(layerPageProtocol, accountAtom, true),
				Authenticate.toLayer(() => pageSignIn),
				OpenUrl.toLayer(() => Effect.void)
			)
		})
	)
}
