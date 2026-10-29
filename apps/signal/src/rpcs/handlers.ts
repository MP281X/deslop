import {Effect, Option} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Game} from '#services/game/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const game = yield* Game
		return RpcContracts.of({
			'signal.join': () => game.join,
			'signal.replay': input => game.replay(input.from, input.speed),
			'signal.thread': input => game.thread(input.team, Option.fromUndefinedOr(input.before)),
			'signal.timeline': () => game.timeline
		})
	})
)
