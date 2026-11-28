import {Effect, Schema, Stream, pipe} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'
import {SqlClient} from 'effect/sql'

import {identifyRequestOf} from '@deslop/runtime/server/auth'
import {AuthError, CLIENT_HEADER, IDENTIFY_PATH, IdentifyRequest, failureOptions} from '@deslop/runtime/shared/auth'
import {Account} from '@deslop/runtime/shared/schema'

import {Identity, isMachine} from './server.ts'

import {IdentityRpcs} from '#identity/contract.ts'

export function authResponse<E, R>(effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) {
	return pipe(
		effect,
		Effect.catchIf(Schema.is(AuthError), error =>
			Effect.succeed(HttpServerResponse.text(error.message, failureOptions(error, 401)))
		),
		Effect.map(HttpServerResponse.setHeader('cache-control', 'no-store'))
	)
}

export const identityHandlers = IdentityRpcs.toLayer(
	Effect.gen(function* () {
		const identity = yield* Identity
		const sql = yield* SqlClient.SqlClient
		return {
			'people.account': (_, options) =>
				Stream.buffer(
					sql.reactive(['people', 'sessions'], identity.resolve(identifyRequestOf(options.headers), true)),
					{capacity: 1, strategy: 'sliding'}
				)
		}
	})
)

export const identityHttp = HttpRouter.use(router =>
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
