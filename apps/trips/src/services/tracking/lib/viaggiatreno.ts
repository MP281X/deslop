import {Cause, Context, Effect, Layer, Schedule, pipe} from 'effect'
import type {Schema} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'

export class ViaggiaTreno extends Context.Service<ViaggiaTreno>()('@deslop/trips/services/tracking/lib/viaggiatreno', {
	make: Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient
		return {
			get: Effect.fn('ViaggiaTreno.get')(function* <S extends Schema.Top>(path: string, schema: S) {
				return yield* pipe(
					// ViaggiaTreno answers only over plain HTTP, and its CDN refuses a client without a browser's User-Agent.
					client.get(`http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/${path}`, {
						headers: {
							'user-agent':
								'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
						}
					}),
					Effect.flatMap(HttpClientResponse.filterStatusOk),
					Effect.flatMap(response => {
						// No content means the number does not run today.
						if (response.status === 204) return Effect.succeedNone
						return Effect.asSome(HttpClientResponse.schemaBodyJson(schema)(response))
					}),
					Effect.timeout('15 seconds'),
					Effect.retry({
						schedule: Schedule.exponential('1 second'),
						times: 2,
						while: error => Cause.isTimeoutError(error) || HttpClient.isTransientError(error)
					})
				)
			})
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
