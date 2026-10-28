import {Effect, Stream} from 'effect'

import {CurrentUser} from '@deslop/runtime/auth/utils'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Game} from '#services/game/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const game = yield* Game
		return RpcContracts.of({
			'signal.ask': input => Stream.unwrap(Effect.map(CurrentUser, user => game.ask(user, input.text))),
			'signal.join': () => Stream.unwrap(Effect.map(CurrentUser, user => game.join(user)))
		})
	})
)
