import {Array, Clock, Effect} from 'effect'

import {DAY, endOf} from '#services/bookings/lib/utils.ts'
import {Bookings} from '#services/bookings/service.ts'
import {Tools} from '#tools/contracts.ts'

export const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const bookings = yield* Bookings
		return Tools.of({
			delete_booking: input => bookings.remove(input.id),
			list_bookings: Effect.fnUntraced(function* () {
				const now = yield* Clock.currentTimeMillis
				return {bookings: Array.filter(yield* bookings.list, booking => endOf(booking) > now - 7 * DAY)}
			}),
			save_booking: input => Effect.map(bookings.save(input), saved => ({bookings: saved}))
		})
	})
)
