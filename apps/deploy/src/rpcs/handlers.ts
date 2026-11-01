import {Effect, Schedule, Stream} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Fleet} from '#services/fleet/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const fleet = yield* Fleet
		return RpcContracts.of({
			'deploy.expose': fleet.expose,
			'deploy.hide': fleet.hide,
			'deploy.history': fleet.history,
			'deploy.inventory': () => Stream.fromEffectSchedule(fleet.snapshot, Schedule.spaced('5 seconds')),
			'deploy.metrics': query => Stream.fromEffectSchedule(fleet.metrics(query), Schedule.spaced('30 seconds')),
			'deploy.snapshot': () => fleet.local
		})
	})
)
