import {Clock, Effect, Layer, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {OtlpLogger, OtlpSerialization, OtlpTracer} from 'effect/observability'

export function layerOtlp(serviceName: string, url: URL | string, runtime: 'web' | 'mobile' | 'server') {
	return Layer.unwrap(
		Effect.gen(function* () {
			const start = `${yield* Clock.currentTimeNanos}`
			const resource = {
				attributes: {'scope.run.started_unix_nano': start, 'scope.runtime': runtime, 'service.instance.id': start},
				serviceName
			}
			return pipe(
				Layer.mergeAll(
					OtlpTracer.layer({exportInterval: '250 millis', resource, url: new URL('/v1/traces', url).href}),
					OtlpLogger.layer({exportInterval: '250 millis', resource, url: new URL('/v1/logs', url).href})
				),
				Layer.provide([OtlpSerialization.layerJson, FetchHttpClient.layer])
			)
		})
	)
}
