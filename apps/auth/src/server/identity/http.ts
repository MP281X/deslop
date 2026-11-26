import {Effect} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {AuthError, CLIENT_HEADER, IDENTIFY_PATH, IdentifyRequest} from '@deslop/runtime/shared/auth'
import {Account} from '@deslop/runtime/shared/schema'

import {authResponse} from '#server/http.ts'
import {Identity, isMachine} from '#server/identity/service.ts'

export const IdentityHttp = HttpRouter.use(router =>
	Effect.gen(function* () {
		const identity = yield* Identity
		yield* router.add(
			'POST',
			IDENTIFY_PATH,
			authResponse(
				Effect.gen(function* () {
					if (!isMachine((yield* HttpServerRequest.HttpServerRequest).headers[CLIENT_HEADER] ?? '')) {
						return HttpServerResponse.text('Only this machine may identify callers', {status: 403})
					}
					return yield* HttpServerResponse.schemaJson(Account)(
						yield* identity.resolve(
							yield* Effect.mapError(HttpServerRequest.schemaBodyJson(IdentifyRequest), cause =>
								AuthError.make({cause, error: 'access_denied', message: 'Invalid identify request'})
							)
						)
					)
				})
			)
		)
	})
)
