import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Option, Schema, Struct} from 'effect'

import {
	activeWindow,
	arrivalClockOf,
	dayMark,
	daysBetween,
	instantOf,
	activityProps,
	startable,
	stayAfter,
	upsert
} from '#services/bookings/lib/utils.ts'
import {Booking, BookingId, Flight, FlightTracking, Place, Stay} from '#services/bookings/schema.ts'

const DEPARTS = DateTime.makeUnsafe('2026-10-28T15:40:00Z')

const FLIGHT = Struct.pick(
	Flight.make({
		airline: 'British Airways',
		airlineCode: 'BA',
		arrives: DateTime.addDuration(DEPARTS, Duration.hours(2.5)),
		boardingAt: Option.none(),
		boardingGroup: Option.none(),
		confirmation: Option.none(),
		departs: DEPARTS,
		from: Schema.decodeSync(Place)({code: 'FCO', name: 'Fiumicino', timeZone: 'Europe/Rome'}),
		id: BookingId.make('7f0c8f8e-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
		live: Option.none(),
		number: '553',
		seat: Option.none(),
		status: 'confirmed',
		to: Schema.decodeSync(Place)({code: 'LHR', name: 'Heathrow', timeZone: 'Europe/London'})
	}),
	Struct.keys(Flight.fields)
)

it('opens a flight three hours ahead', () => {
	assert.isTrue(Option.isNone(activeWindow(FLIGHT, DateTime.subtractDuration(DEPARTS, Duration.minutes(181)))))
	assert.isTrue(Option.isSome(activeWindow(FLIGHT, DateTime.subtractDuration(DEPARTS, Duration.hours(3)))))
	assert.strictEqual(
		activityProps(FLIGHT, [], DateTime.subtractDuration(DEPARTS, Duration.hours(3)), false).headline,
		'Leave for FCO'
	)
})

it('reads local ticket times in the place zone and explicit offsets as given', () => {
	assert.deepStrictEqual(instantOf('2026-10-28T16:40', Option.some('Europe/Rome')), Option.some(DEPARTS))
	assert.deepStrictEqual(instantOf('2026-10-28T17:40+02:00', Option.some('Europe/London')), Option.some(DEPARTS))
	assert.deepStrictEqual(instantOf('2026-10-28T17:40+02:00', Option.none()), Option.some(DEPARTS))
	assert.deepStrictEqual(instantOf('2026-10-28T15:40Z', Option.none()), Option.some(DEPARTS))
	assert.deepStrictEqual(instantOf('2026-10-28T16:40', Option.none()), Option.none())
})

it('reads no moment from a date or clock the place never shows', () => {
	assert.deepStrictEqual(
		[
			instantOf('2026-02-30T12:00', Option.some('Europe/Rome')),
			instantOf('2026-02-30T12:00+01:00', Option.none()),
			instantOf('2026-03-29T02:30', Option.some('Europe/Rome')),
			instantOf('2026-10-28T25:10', Option.some('Europe/Rome'))
		],
		[Option.none(), Option.none(), Option.none(), Option.none()]
	)
	// The hour repeated as summer time ends reads as its first occurrence.
	assert.deepStrictEqual(
		instantOf('2026-10-25T02:30', Option.some('Europe/Rome')),
		Option.some(DateTime.makeUnsafe('2026-10-25T00:30:00Z'))
	)
})

it('counts calendar days between local dates and marks an arrival on another date', () => {
	assert.deepStrictEqual(
		[
			daysBetween(
				DateTime.makeUnsafe('2026-11-19T14:50:00Z'),
				'Asia/Tokyo',
				DateTime.makeUnsafe('2026-11-19T09:50:00Z'),
				'Pacific/Honolulu'
			),
			daysBetween(
				DateTime.makeUnsafe('2026-11-19T21:30:00Z'),
				'Europe/Rome',
				DateTime.makeUnsafe('2026-11-20T08:00:00Z'),
				'Europe/Rome'
			)
		],
		[-1, 1]
	)
	assert.deepStrictEqual([dayMark(0), dayMark(1), dayMark(-1)], ['', ' +1', ' −1'])
	assert.strictEqual(
		arrivalClockOf(
			Flight.make({
				...FLIGHT,
				arrives: DateTime.makeUnsafe('2026-10-29T06:30:00Z'),
				departs: DateTime.makeUnsafe('2026-10-28T21:00:00Z')
			})
		),
		'06:30 +1'
	)
})

function stay(id: string, city: string) {
	return Stay.make({
		checkIn: DateTime.makeUnsafe('2026-11-18T10:00Z'),
		checkOut: DateTime.makeUnsafe('2026-11-19T09:00Z'),
		confirmation: Option.none(),
		id: BookingId.make(id),
		name: `Hotel in ${city}`,
		place: Schema.decodeSync(Place)({
			address: `Via Roma 1, ${city}, Italy`,
			city,
			name: `Hotel in ${city}`,
			timeZone: 'Europe/Rome'
		}),
		status: 'confirmed'
	})
}

it('offers a stay as the next stop only in the city the flight reaches', () => {
	const arriving = Flight.make({
		...FLIGHT,
		arrives: DateTime.makeUnsafe('2026-11-18T09:00Z'),
		departs: DateTime.makeUnsafe('2026-11-18T08:00Z'),
		to: Schema.decodeSync(Place)({city: 'Verona', code: 'VRN', name: 'Verona Villafranca', timeZone: 'Europe/Rome'})
	})
	const rome = stay('33333333-3333-4333-8333-333333333333', 'Roma')
	const verona = stay('44444444-4444-4444-8444-444444444444', 'Verona')
	assert.deepStrictEqual(
		[
			Option.map(stayAfter([rome], arriving), found => found.name),
			Option.map(stayAfter([rome, verona], arriving), found => found.name)
		],
		[Option.none(), Option.some('Hotel in Verona')]
	)
})

it('starts no Live Activity for a cancelled flight', () => {
	const departing = Flight.make({
		...FLIGHT,
		arrives: DateTime.makeUnsafe('2026-11-18T09:00Z'),
		departs: DateTime.makeUnsafe('2026-11-18T08:00Z')
	})
	const cancelled = Flight.make({
		...FLIGHT,
		arrives: departing.arrives,
		departs: departing.departs,
		live: Option.some(Schema.decodeSync(FlightTracking)({checkedAt: 1, state: 'cancelled'}))
	})
	assert.deepStrictEqual(
		[startable(departing, departing.departs), startable(cancelled, departing.departs)],
		[true, false]
	)
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
			Booking.isAnyOf(['flight'])(booking) && booking.seat,
			Booking.isAnyOf(['flight'])(booking) && Option.flatMap(booking.live, live => live.departureGate)
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
			booking => Booking.isAnyOf(['flight'])(booking) && booking.live
		),
		[Option.none()]
	)
})

it('keeps tickets with different confirmation codes as separate bookings', () => {
	function other(confirmation: Option.Option<string>) {
		return Flight.make({...FLIGHT, confirmation, id: BookingId.make('cccccccc-0d0a-4a5e-9d8f-5b2a1c3d4e5f')})
	}
	const held = Flight.make({...FLIGHT, confirmation: Option.some('ABC123')})
	assert.deepStrictEqual(
		Array.map(
			[Option.some('XYZ789'), Option.some(' abc123 '), Option.none()],
			confirmation => upsert([held], [other(confirmation)]).length
		),
		[2, 1, 1]
	)
	assert.lengthOf(upsert([FLIGHT], [other(Option.some('XYZ789'))]), 1)
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
		Array.map([-1, 2, 10], hours =>
			Option.map(activeWindow(long, DateTime.addDuration(DEPARTS, Duration.hours(hours))), window => window.leg)
		),
		[Option.some('departure'), Option.none(), Option.some('arrival')]
	)
	assert.deepStrictEqual(
		Option.map(activeWindow(FLIGHT, DateTime.addDuration(DEPARTS, Duration.hours(2))), window => window.leg),
		Option.some('departure')
	)
})
