import {Effect, Schedule, Stream} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Fleet} from '#services/fleet/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const fleet = yield* Fleet
		return RpcContracts.of({
			'deploy.expose': fleet.expose,
			'deploy.hide': fleet.hide,
			'deploy.inventory': () => Stream.fromEffectSchedule(fleet.snapshot, Schedule.spaced('5 seconds')),
			'deploy.snapshot': () => fleet.local
		})
	})
)
