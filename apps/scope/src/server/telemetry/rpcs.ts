import {Effect} from 'effect'

import {layerRpc} from '@deslop/runtime/server/http'

import {TelemetryRpc} from '#contracts'

import {Telemetry} from '#server/telemetry/service.ts'

export const TelemetryRpcs = layerRpc({
	group: TelemetryRpc,
	handlers: TelemetryRpc.toLayer(
		Effect.map(Telemetry, telemetry => ({
			'telemetry.trace': input => telemetry.watchTrace(input.id),
			'telemetry.watch': range => telemetry.watch(range)
		}))
	)
})
