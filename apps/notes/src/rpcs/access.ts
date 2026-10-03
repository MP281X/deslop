import {Config, Effect, pipe} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

export const Access = HttpRouter.middleware(
	Effect.gen(function* () {
		const origin = yield* pipe(Config.URL('NOTES_ORIGIN'), Config.withDefault(new URL('http://127.0.0.1:5017')))
		return httpEffect =>
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				if (request.headers['origin'] !== origin.origin || request.headers['host'] !== origin.host) {
					return HttpServerResponse.empty({status: 403})
				}
				return yield* httpEffect
			})
	})
).layer
