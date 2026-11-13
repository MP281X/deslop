import {Effect, Layer, Option, pipe} from 'effect'

import {HttpClient, HttpClientResponse} from 'effect/http'

import {RUNTIME_PATH, RuntimeConfig} from '#shared/schema.ts'
import {layerOtlp} from '#shared/telemetry.ts'

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
				onSome: settings => {
					if (settings.traces === '') return Layer.empty
					return layerOtlp(`${applicationName}-client`, settings.traces, 'web', settings.version)
				}
			})
		})
	)
}
