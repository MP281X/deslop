import {NodeHttpClient} from '@effect/platform-node'

import {ByteSize, Config, Effect, Layer, pipe} from 'effect'

import {HttpClient, HttpClientRequest, HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'

import {Access} from '#rpcs/access.ts'

export const Telemetry = pipe(
	HttpRouter.use(router =>
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient
			const upstream = yield* pipe(Config.URL('VITE_OTEL_URL'), Config.withDefault(new URL('http://127.0.0.1:4318')))
			yield* Effect.forEach(
				['/v1/traces', '/v1/logs'] as const,
				path =>
					router.add(
						'POST',
						path,
						Effect.gen(function* () {
							const request = yield* HttpServerRequest.HttpServerRequest
							const body = yield* Effect.provideService(
								request.arrayBuffer,
								HttpServerRequest.MaxBodySize,
								ByteSize.megabytes(1)
							)
							const response = yield* client.execute(
								pipe(
									HttpClientRequest.post(new URL(path, upstream)),
									HttpClientRequest.bodyUint8Array(
										new Uint8Array(body),
										request.headers['content-type'] ?? 'application/json'
									)
								)
							)
							return HttpServerResponse.text(yield* response.text, {status: response.status})
						})
					),
				{discard: true}
			)
		})
	),
	Layer.provide(Access),
	Layer.provide(NodeHttpClient.layerFetch)
)
