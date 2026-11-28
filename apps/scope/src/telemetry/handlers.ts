import {Effect} from 'effect'

import {TelemetryRpcs} from './contract.ts'
import {Telemetry} from './server.ts'

export const telemetryHandlers = TelemetryRpcs.toLayer(
	Effect.map(Telemetry, telemetry => ({
		'telemetry.trace': input => telemetry.watchTrace(input.id),
		'telemetry.watch': range => telemetry.watch(range)
	}))
)
