import {Effect, Schema, pipe} from 'effect'

import {HttpServerResponse} from 'effect/http'

import {AuthError, failureOptions} from '@deslop/runtime/shared/auth'

export function authResponse<E, R>(effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) {
	return pipe(
		effect,
		Effect.catchIf(Schema.is(AuthError), error =>
			Effect.succeed(HttpServerResponse.text(error.message, failureOptions(error, 401)))
		),
		Effect.map(HttpServerResponse.setHeader('cache-control', 'no-store'))
	)
}
