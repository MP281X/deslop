import {Effect} from 'effect'

import {PushRpcs} from './contract.ts'
import {Push} from './server.ts'

import {Rounds} from '#rounds/server.ts'

// A round follows each registration, so a phone that registers inside a flight's window gets its Live Activity and the alerts it is owed at once; activities start only this way.
export const pushHandlers = PushRpcs.toLayerHandler(
	'push.register',
	Effect.gen(function* () {
		const push = yield* Push
		const rounds = yield* Rounds
		return input => Effect.andThen(push.register(input), rounds.tick)
	})
)
