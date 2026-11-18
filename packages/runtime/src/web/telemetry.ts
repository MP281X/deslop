import {Effect, Layer, Option, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'

import {RUNTIME_PATH, RuntimeConfig} from '#shared/schema.ts'
import {layerOtlp} from '#shared/telemetry.ts'

// judge-ignore no-silent-fallback -- Telemetry is optional: config failures are logged, and tracing stays off rather than preventing the app from opening.
export function layerWebTelemetry(applicationName: string) {
	return Layer.unwrap(
		Effect.gen(function* () {
			const config = yield* pipe(
				(yield* HttpClient.HttpClient).get(RUNTIME_PATH),
				Effect.flatMap(HttpClientResponse.filterStatusOk),
				Effect.flatMap(HttpClientResponse.schemaBodyJson(RuntimeConfig)),
				Effect.timeout('3 seconds'),
				Effect.tapError(error => Effect.logWarning('Telemetry is off: the runtime config did not load', error)),
				Effect.option
			)
			return Option.match(config, {
				onNone: () => Layer.empty,
				onSome: settings =>
					Option.match(settings.traces, {
						onNone: () => Layer.empty,
						onSome: traces => layerOtlp(`${applicationName}-client`, traces, 'web', settings.version)
					})
			})
		})
	)
}
