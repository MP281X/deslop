import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Option, Schema, Struct} from 'effect'

import {
	activeWindow,
	arrivalClockOf,
	daysBetween,
	instantOf,
	activityProps,
	startable,
	upsert
} from '#services/flights/lib/utils.ts'
import {FlightId, Flight, FlightTracking, Place} from '#services/flights/schema.ts'

const DEPARTS = DateTime.makeUnsafe('2026-10-28T15:40:00Z')

const FLIGHT = Struct.pick(
	Flight.make({
		airline: 'British Airways',
		airlineCode: 'BA',
		arrives: DateTime.addDuration(DEPARTS, Duration.hours(2.5)),
		boardingAt: Option.none(),
		confirmation: Option.none(),
		departs: DEPARTS,
		from: Schema.decodeSync(Place)({code: 'FCO', name: 'Fiumicino', timeZone: 'Europe/Rome'}),
		id: FlightId.make('7f0c8f8e-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
		live: Option.none(),
		number: '553',
		status: 'confirmed',
		to: Schema.decodeSync(Place)({code: 'LHR', name: 'Heathrow', timeZone: 'Europe/London'}),
		travellers: []
	}),
	Struct.keys(Flight.fields)
)

it('opens a flight three hours ahead', () => {
	assert.isTrue(Option.isNone(activeWindow(FLIGHT, DateTime.subtractDuration(DEPARTS, Duration.minutes(181)))))
	assert.isTrue(Option.isSome(activeWindow(FLIGHT, DateTime.subtractDuration(DEPARTS, Duration.hours(3)))))
	assert.strictEqual(
		activityProps(FLIGHT, DateTime.subtractDuration(DEPARTS, Duration.hours(3)), false).headline,
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

function traveller(name: Option.Option<string>, seat: Option.Option<string>) {
	return {boardingGroup: Option.none(), name, seat}
}

it('merges tickets for the same leg and retains live data only while its schedule matches', () => {
	const tracked = Flight.make({
		...FLIGHT,
		confirmation: Option.some('ABC123'),
		live: Option.some(Schema.decodeSync(FlightTracking)({checkedAt: 1, departureGate: 'B12', state: 'scheduled'})),
		travellers: [traveller(Option.some('Matteo Rossi'), Option.none())]
	})
	const again = Flight.make({
		...FLIGHT,
		id: FlightId.make('aaaaaaaa-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
		travellers: [traveller(Option.some('ROSSI/MATTEO MR'), Option.some('14A'))]
	})
	assert.deepStrictEqual(
		Array.map(upsert([tracked], [again]), flight => [
			flight.id,
			flight.confirmation,
			flight.travellers,
			Option.flatMap(flight.live, live => live.departureGate)
		]),
		[
			[
				FLIGHT.id,
				Option.some('ABC123'),
				[traveller(Option.some('ROSSI/MATTEO MR'), Option.some('14A'))],
				Option.some('B12')
			]
		]
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
						travellers: again.travellers
					})
				]
			),
			flight => flight.live
		),
		[Option.none()]
	)
})

it('adds each traveller a ticket names to the flight, whatever its confirmation code', () => {
	const held = Flight.make({
		...FLIGHT,
		confirmation: Option.some('ABC123'),
		travellers: [traveller(Option.none(), Option.some('14C'))]
	})
	function pass(name: string, seat: string) {
		return Flight.make({
			...FLIGHT,
			confirmation: Option.some('XYZ789'),
			id: FlightId.make('cccccccc-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
			travellers: [traveller(Option.some(name), Option.some(seat))]
		})
	}
	// The flight saved before names were read is whoever sits in 14C.
	assert.deepStrictEqual(
		Array.map(
			upsert([held], [pass('Matteo Rossi', '14C'), pass('Anna Bianchi', '14D'), pass('Anna Bianchi', '15A')]),
			flight => [flight.confirmation, flight.travellers]
		),
		[
			[
				Option.some('ABC123'),
				[
					traveller(Option.some('Matteo Rossi'), Option.some('14C')),
					traveller(Option.some('Anna Bianchi'), Option.some('15A'))
				]
			]
		]
	)
})

it('keeps distinct legs of the same flight number as distinct flights', () => {
	assert.lengthOf(
		upsert(
			[FLIGHT],
			[
				Flight.make({
					...FLIGHT,
					departs: DateTime.addDuration(DEPARTS, Duration.hours(15)),
					from: FLIGHT.to,
					id: FlightId.make('bbbbbbbb-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
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
