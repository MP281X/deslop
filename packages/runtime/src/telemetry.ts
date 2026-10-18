import {Layer, pipe} from 'effect'

import {FetchHttpClient} from 'effect/http'
import {OtlpLogger, OtlpSerialization, OtlpTracer} from 'effect/observability'

export function layerOtlp(serviceName: string, url: URL | string) {
	const resource = {serviceName}
	return pipe(
		Layer.mergeAll(
			OtlpTracer.layer({resource, url: new URL('/v1/traces', url).href}),
			OtlpLogger.layer({resource, url: new URL('/v1/logs', url).href})
		),
		Layer.provide([OtlpSerialization.layerJson, FetchHttpClient.layer])
	)
}
