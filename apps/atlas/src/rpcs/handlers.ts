import {Effect, Schedule, Stream} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Changes} from '#services/changes/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const changes = yield* Changes
		const snapshot = yield* Stream.share(
			Stream.concat(
				Stream.fromEffect(changes.snapshot),
				Stream.fromEffectSchedule(changes.snapshot, Schedule.spaced('60 seconds'))
			),
			{capacity: 1, replay: 1, strategy: 'sliding'}
		)
		return RpcContracts.of({'atlas.snapshot': () => snapshot})
	})
)
