import {Cause, Clock, Effect, Layer, Option, pipe} from 'effect'

import {FetchHttpClient, UrlParams} from 'effect/http'
import {OtlpLogger, OtlpSerialization, OtlpTracer} from 'effect/observability'

// Scope's receiver is public, so exporters send no credentials; a release names its version, so Scope can drop what older ones sent.
export function layerOtlp(serviceName: string, url: string, runtime: 'web' | 'mobile' | 'server', version: string) {
	return pipe(
		Layer.unwrap(
			Effect.gen(function* () {
				const start = `${yield* Clock.currentTimeNanos}`
				const redacted = yield* UrlParams.CurrentRedactedNames
				const resource = {
					attributes: {'scope.run.started_unix_nano': start, 'scope.runtime': runtime, 'service.instance.id': start},
					serviceName,
					// A local build or Simulator run is 0.1.0, unreleased: without a version, Scope never takes it for an old release.
					serviceVersion: Option.getOrUndefined(Option.liftPredicate(version, current => current !== '0.1.0'))
				}
				return pipe(
					Layer.mergeAll(
						OtlpTracer.layer({resource, url: new URL('/v1/traces', url).href}),
						OtlpLogger.layer({resource, url: new URL('/v1/logs', url).href}),
						Layer.succeed(UrlParams.CurrentRedactedNames)([
							...redacted,
							'code',
							'state',
							'request',
							'access_token',
							'refresh_token',
							'id_token',
							'client_secret',
							'client_assertion',
							'code_verifier',
							'session',
							'token'
						])
					),
					Layer.provide([OtlpSerialization.layerJson, FetchHttpClient.layer])
				)
			})
		),
		Layer.catchCause(cause => {
			if (Cause.hasInterrupts(cause)) return Layer.effectDiscard(Effect.interrupt)
			return Layer.effectDiscard(Effect.logWarning('Telemetry is unavailable'))
		})
	)
}
