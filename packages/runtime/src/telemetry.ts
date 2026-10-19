import {Boolean, Clock, Effect, Layer, pipe} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest} from 'effect/http'
import {OtlpLogger, OtlpSerialization, OtlpTracer} from 'effect/observability'

import type {AuthError} from '@deslop/auth/schema'

export function layerOtlp(
	serviceName: string,
	url: URL | string,
	runtime: 'web' | 'mobile' | 'server',
	authorization?: Effect.Effect<string, AuthError, HttpClient.HttpClient>
) {
	return Layer.unwrap(
		Effect.gen(function* () {
			const start = `${yield* Clock.currentTimeNanos}`
			const client = pipe(
				Layer.effect(
					HttpClient.HttpClient,
					Effect.map(HttpClient.HttpClient, raw =>
						HttpClient.mapRequestEffect(
							HttpClient.transform(raw, effect =>
								Effect.provideService(effect, FetchHttpClient.RequestInit, {
									credentials: Boolean.match(new URL(url).origin === 'https://otel.mp281x.xyz', {
										onFalse: () => 'omit' as const,
										onTrue: () => 'include' as const
									})
								})
							),
							request => {
								if (authorization === undefined) return Effect.succeed(request)
								return pipe(
									authorization,
									Effect.provideService(HttpClient.HttpClient, raw),
									Effect.map(token => HttpClientRequest.bearerToken(request, token)),
									Effect.mapError(
										// oxlint-disable-next-line @deslop/coding-standards/preserve-error-cause -- HttpClientError carries its original cause in reason.cause, not a top-level field.
										cause =>
											new HttpClientError.HttpClientError({
												reason: new HttpClientError.TransportError({cause, request})
											})
									)
								)
							}
						)
					)
				),
				Layer.provide(FetchHttpClient.layer)
			)
			const resource = {
				attributes: {'scope.run.started_unix_nano': start, 'scope.runtime': runtime, 'service.instance.id': start},
				serviceName
			}
			return pipe(
				Layer.mergeAll(
					OtlpTracer.layer({exportInterval: '250 millis', resource, url: new URL('/v1/traces', url).href}),
					OtlpLogger.layer({exportInterval: '250 millis', resource, url: new URL('/v1/logs', url).href})
				),
				Layer.provide([OtlpSerialization.layerJson, client])
			)
		})
	)
}
