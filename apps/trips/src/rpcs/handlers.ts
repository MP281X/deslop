import {Effect} from 'effect'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Flights} from '#services/flights/service.ts'
import {Push} from '#services/push/service.ts'
import {Tracking} from '#services/tracking/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const flights = yield* Flights
		const push = yield* Push
		const tracker = yield* Tracking
		return RpcContracts.of({
			'flights.events': () => flights.events,
			'flights.remove': input => flights.remove(input.id),
			'flights.save': input => Effect.flatMap(CurrentUser, user => flights.save(user.id, input)),
			'push.register': input => push.register(input),
			'push.start': input => push.start(input.id),
			'tracking.refresh': input => tracker.refresh(input.id)
		})
	})
)
