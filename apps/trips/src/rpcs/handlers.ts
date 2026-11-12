import {Effect} from 'effect'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Bookings} from '#services/bookings/service.ts'
import {Push} from '#services/push/service.ts'
import {Tracker} from '#services/tracking/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const bookings = yield* Bookings
		const push = yield* Push
		const tracker = yield* Tracker
		return RpcContracts.of({
			'bookings.events': () => bookings.events,
			'bookings.remove': input => bookings.remove(input.id),
			'bookings.save': input => Effect.flatMap(CurrentUser, user => bookings.save(user.id, input)),
			'push.register': input => push.register(input),
			'tracking.refresh': input => tracker.refresh(input.id)
		})
	})
)
