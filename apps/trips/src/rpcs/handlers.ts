import {Effect} from 'effect'

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
			'activities.claim': input => push.claim(input),
			'activities.register': input => push.activity(input),
			'bookings.refresh': input => tracker.refresh(input.id),
			'bookings.remove': input => bookings.remove(input.id),
			'bookings.restore': input => bookings.restore(input),
			'bookings.save': input => bookings.save(input),
			'bookings.watch': () => bookings.events,
			'devices.register': input => push.register(input)
		})
	})
)
