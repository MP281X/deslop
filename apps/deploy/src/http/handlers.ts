import {Array, Cause, Effect} from 'effect'

import {HttpRouter, HttpServerResponse} from 'effect/http'

import {startUpdates} from '@deslop/runtime/server/services'

// Release's last step: every app on this machine installs what Release just published. It takes no sign-in, since it can only install a version already on npm.
export const HttpHandlers = HttpRouter.use(router =>
	router.add(
		'POST',
		'/api/update',
		Effect.matchCauseEffect(startUpdates(), {
			onFailure: cause =>
				Effect.as(
					Effect.logError('The app updates could not be started', cause),
					HttpServerResponse.text(Cause.pretty(cause), {status: 500})
				),
			onSuccess: units =>
				Effect.succeed(HttpServerResponse.text(`Started ${Array.join(units, ', ') || 'nothing'}\n`, {status: 202}))
		})
	)
)
