import {Effect} from 'effect'

import {Telemetry} from '#services/telemetry/service.ts'
import {Tools} from '#tools/contracts.ts'

export const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const telemetry = yield* Telemetry
		return Tools.of({
			check_ingestion: () => telemetry.checkIngestion(),
			find_traces: input => telemetry.findTraces(input),
			list_operations: input => telemetry.listOperations(input),
			measure_latency: input => telemetry.measureLatency(input),
			read_trace: input => telemetry.readTrace(input),
			search_logs: input => telemetry.searchLogs(input)
		})
	})
)
