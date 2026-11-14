import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Option, Schema} from 'effect'

import {activeWindow, instantOf, upsert} from '#services/bookings/lib/utils.ts'
import {BookingId, Flight, FlightTracking} from '#services/bookings/schema.ts'

const DEPARTS = DateTime.makeUnsafe('2026-10-28T15:40:00Z')
const FLIGHT = Schema.decodeSync(Flight.json)({
	_tag: 'flight',
	airline: 'British Airways',
	airlineCode: 'BA',
	arrives: DateTime.toEpochMillis(DateTime.addDuration(DEPARTS, Duration.hours(2.5))),
	departs: DateTime.toEpochMillis(DEPARTS),
	from: {code: 'FCO', name: 'Fiumicino', timeZone: 'Europe/Rome'},
	id: '7f0c8f8e-0d0a-4a5e-9d8f-5b2a1c3d4e5f',
	number: '553',
	status: 'confirmed',
	to: {code: 'LHR', name: 'Heathrow', timeZone: 'Europe/London'}
})

it('reads local ticket times in the place zone and explicit offsets as given', () => {
	assert.deepStrictEqual(instantOf('2026-10-28T16:40', 'Europe/Rome'), Option.some(DEPARTS))
	assert.deepStrictEqual(instantOf('2026-10-28T17:40+02:00', 'Europe/London'), Option.some(DEPARTS))
})

it('merges tickets for the same leg and retains live data only while its schedule matches', () => {
	const tracked = Flight.make({
		...FLIGHT,
		confirmation: Option.some('ABC123'),
		live: Option.some(Schema.decodeSync(FlightTracking)({checkedAt: 1, departureGate: 'B12', state: 'scheduled'}))
	})
	const again = Flight.make({
		...FLIGHT,
		id: BookingId.make('aaaaaaaa-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
		seat: Option.some('14A')
	})
	assert.deepStrictEqual(
		Array.map(upsert([tracked], [again]), booking => [
			booking.id,
			booking.confirmation,
			booking._tag === 'flight' && booking.seat,
			booking._tag === 'flight' && Option.flatMap(booking.live, live => live.departureGate)
		]),
		[[FLIGHT.id, Option.some('ABC123'), Option.some('14A'), Option.some('B12')]]
	)
	assert.deepStrictEqual(
		Array.map(
			upsert(
				[tracked],
				[
					Flight.make({
						...FLIGHT,
						departs: DateTime.addDuration(DEPARTS, Duration.hours(3)),
						id: again.id,
						seat: again.seat
					})
				]
			),
			booking => booking._tag === 'flight' && booking.live
		),
		[Option.none()]
	)
})

it('keeps distinct legs of the same flight number as distinct bookings', () => {
	assert.lengthOf(
		upsert(
			[FLIGHT],
			[
				Flight.make({
					...FLIGHT,
					departs: DateTime.addDuration(DEPARTS, Duration.hours(15)),
					from: FLIGHT.to,
					id: BookingId.make('bbbbbbbb-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
					to: FLIGHT.from
				})
			]
		),
		2
	)
})

it('splits long flights into departure and arrival activity windows', () => {
	const long = Flight.make({...FLIGHT, arrives: DateTime.addDuration(DEPARTS, Duration.hours(11))})
	assert.deepStrictEqual(
		Array.map([-1, 4, 10], hours =>
			Option.map(activeWindow(long, DateTime.addDuration(DEPARTS, Duration.hours(hours))), window => window.leg)
		),
		[Option.some('departure'), Option.none(), Option.some('arrival')]
	)
	assert.deepStrictEqual(
		Option.map(activeWindow(FLIGHT, DateTime.addDuration(DEPARTS, Duration.hours(2))), window => window.leg),
		Option.some('departure')
	)
})
