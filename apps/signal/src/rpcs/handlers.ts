import {Effect, Stream} from 'effect'

import {CurrentUser} from '@deslop/runtime/auth/utils'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Game} from '#services/game/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const game = yield* Game
		return RpcContracts.of({
			'signal.act': action => Effect.flatMap(CurrentUser, user => game.act(user, action)),
			'signal.ask': input => Stream.unwrap(Effect.map(CurrentUser, user => game.ask(user, input))),
			'signal.join': input => Stream.unwrap(Effect.map(CurrentUser, user => game.join(user, input.invite))),
			'signal.steer': input => Effect.flatMap(CurrentUser, user => game.steer(user, input))
		})
	})
)
