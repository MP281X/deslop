import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {Booking, BookingId, BookingsError} from '#services/bookings/schema.ts'

export const Tools = Toolkit.make(
	Tool.make('list_bookings', {
		description:
			"List the user's flights, trains and stays from the last week onward, soonest first, with live status: gates, terminals, delays, platforms and baggage belts. Times are epoch milliseconds; each place carries its IANA time zone.",
		success: Schema.Struct({bookings: Schema.Array(Booking)})
	}).annotate(Tool.Readonly, true),
	Tool.make('save_booking', {
		description:
			"Read a booking confirmation, e-ticket or itinerary text and add or update the flights, trains and stays it confirms. A known reservation is updated rather than duplicated. When any segment's airport or time cannot be read, nothing is saved and the failure names it.",
		failure: BookingsError,
		parameters: Schema.Struct({text: Schema.NonEmptyString}),
		success: Schema.Struct({bookings: Schema.Array(Booking)})
	}).annotate(Tool.Destructive, false),
	Tool.make('delete_booking', {
		description: 'Delete a booking, such as a duplicate or one read wrongly.',
		failure: BookingsError,
		parameters: Schema.Struct({id: BookingId})
	})
)
