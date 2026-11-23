import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Function, Option, Schema, Struct} from 'effect'

import {
	activeWindow,
	arrivalClockOf,
	daysBetween,
	instantOf,
	activityProps,
	cancelledOf,
	startable,
	upsert
} from '#services/flights/lib/utils.ts'
import type {FlightList, ReservationStatus, Traveller} from '#services/flights/schema.ts'
import {FlightId, Flight, FlightTracking, Place} from '#services/flights/schema.ts'

const DEPARTS = DateTime.makeUnsafe('2026-10-28T15:40:00Z')

const FLIGHT = Struct.pick(
	Flight.make({
		airline: 'British Airways',
		airlineCode: 'BA',
		arrives: DateTime.addDuration(DEPARTS, Duration.hours(2.5)),
		boardingAt: Option.none(),
		departs: DEPARTS,
		from: Schema.decodeSync(Place)({code: 'FCO', name: 'Fiumicino', timeZone: 'Europe/Rome'}),
		id: FlightId.make('7f0c8f8e-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
		live: Option.none(),
		number: '553',
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

function traveller(
	confirmation: string,
	name: Option.Option<string>,
	seat: Option.Option<string>,
	status: ReservationStatus = 'confirmed'
) {
	return {boardingGroup: Option.none(), confirmation: Option.some(confirmation), name, seat, status} satisfies Traveller
}

// One ticket for BA 553, or another flight on the same route, read under an id of its own as each shared ticket is.
function ticket(travellers: readonly Traveller[], number = '553', departs = DEPARTS) {
	return Flight.make({
		...FLIGHT,
		departs,
		id: FlightId.make(`${number}00000-0d0a-4a5e-9d8f-5b2a1c3d4e5f`),
		number,
		travellers
	})
}

// A cancellation of a whole booking, naming nobody.
function cancellation(code: string) {
	return ticket([traveller(code, Option.none(), Option.none(), 'cancelled')])
}

// Who is on each flight, and whether it reads cancelled.
function seating(flights: FlightList) {
	return Array.map(flights, flight => [
		flight.number,
		cancelledOf(flight),
		Array.map(flight.travellers, held => [
			Option.getOrElse(held.name, Function.constant('')),
			Option.getOrElse(held.seat, Function.constant('')),
			Option.getOrElse(held.confirmation, Function.constant('')),
			held.status
		])
	])
}

it('merges tickets for the same leg and retains live data only while its schedule matches', () => {
	const tracked = Flight.make({
		...FLIGHT,
		live: Option.some(Schema.decodeSync(FlightTracking)({checkedAt: 1, departureGate: 'B12', state: 'scheduled'})),
		travellers: [traveller('ABC123', Option.some('Matteo Rossi'), Option.none())]
	})
	const again = ticket([traveller('abc123 ', Option.some('ROSSI/MATTEO MR'), Option.some('14A'))])
	assert.deepStrictEqual(
		Array.map(upsert([tracked], [again]), flight => [
			flight.id,
			flight.travellers,
			Option.flatMap(flight.live, live => live.departureGate)
		]),
		[[FLIGHT.id, [traveller('abc123 ', Option.some('ROSSI/MATTEO MR'), Option.some('14A'))], Option.some('B12')]]
	)
	assert.deepStrictEqual(
		Array.map(
			upsert([tracked], [ticket(again.travellers, '553', DateTime.addDuration(DEPARTS, Duration.hours(3)))]),
			flight => flight.live
		),
		[Option.none()]
	)
})

it('adds each traveller a ticket names to the flight under their own reservation', () => {
	// The flight saved before names were read is whoever sits in 14C under its code; a seat changed later stays with its person.
	assert.deepStrictEqual(
		seating(
			upsert(
				[Flight.make({...FLIGHT, travellers: [traveller('ABC123', Option.none(), Option.some('14C'))]})],
				[
					ticket([traveller('ABC123', Option.some('Matteo Rossi'), Option.some('014C'))]),
					ticket([traveller('XYZ789', Option.some('Anna Bianchi'), Option.some('14D'))]),
					ticket([traveller('XYZ789', Option.some('Anna Bianchi'), Option.some('15A'))])
				]
			)
		),
		[
			[
				'553',
				false,
				[
					['Matteo Rossi', '014C', 'ABC123', 'confirmed'],
					['Anna Bianchi', '15A', 'XYZ789', 'confirmed']
				]
			]
		]
	)
})

it('cancels only the travellers of the reservation a cancellation names', () => {
	const both = upsert(
		[],
		[
			ticket([traveller('ONE', Option.some('Alice Hart'), Option.some('11A'))]),
			ticket([traveller('TWO', Option.some('Bob Stone'), Option.some('11B'))])
		]
	)
	// Bob is rebooked onto BA 543 on the same route, then BA 553's cancellation of his booking arrives.
	const rebooked = upsert(both, [
		ticket([traveller('TWO', Option.some('Bob Stone'), Option.some('20C'))], '543'),
		ticket(
			[traveller('TWO', Option.some('Bob Stone'), Option.none(), 'cancelled')],
			'553',
			DateTime.addDuration(DEPARTS, Duration.minutes(30))
		)
	])
	assert.deepStrictEqual(seating(rebooked), [
		[
			'553',
			false,
			[
				['Alice Hart', '11A', 'ONE', 'confirmed'],
				['Bob Stone', '', 'TWO', 'cancelled']
			]
		],
		['543', false, [['Bob Stone', '20C', 'TWO', 'confirmed']]]
	])
	// A cancellation changes no time another traveller's ticket gave.
	assert.deepStrictEqual(
		Array.map(rebooked, flight => flight.departs),
		[DEPARTS, DEPARTS]
	)
	// A cancellation that names nobody covers its whole reservation; the flight reads cancelled once nobody is left booked.
	assert.deepStrictEqual(Array.map(upsert(both, [cancellation('TWO')]), cancelledOf), [false])
	assert.deepStrictEqual(seating(upsert(both, [cancellation('TWO'), cancellation('ONE')])), [
		[
			'553',
			true,
			[
				['Alice Hart', '11A', 'ONE', 'cancelled'],
				['Bob Stone', '11B', 'TWO', 'cancelled']
			]
		]
	])
})

it('keeps travellers apart whatever script their names are in, and two of the same name in two seats', () => {
	const passengers = upsert(
		[],
		[
			ticket([traveller('ONE', Option.some('王小明'), Option.some('11A'))]),
			ticket([traveller('ONE', Option.some('김민지'), Option.some('11B'))]),
			ticket([
				traveller('TWO', Option.some('Sam Lee'), Option.some('12A')),
				traveller('TWO', Option.some('Sam Lee'), Option.some('12B')),
				traveller('TWO', Option.some('Sam Lee'), Option.some('12B'))
			])
		]
	)
	const expected = [
		[
			'553',
			false,
			[
				['王小明', '11A', 'ONE', 'confirmed'],
				['김민지', '11B', 'ONE', 'confirmed'],
				['Sam Lee', '12A', 'TWO', 'confirmed'],
				['Sam Lee', '12B', 'TWO', 'confirmed']
			]
		]
	]
	assert.deepStrictEqual(seating(passengers), expected)
	// Each pass shared again finds the person it names, never the other of the same name.
	assert.deepStrictEqual(
		seating(
			upsert(passengers, [
				ticket([traveller('TWO', Option.some('LEE/SAM MR'), Option.some('12B'))]),
				ticket([traveller('ONE', Option.some('김민지'), Option.some('11B'))]),
				ticket([
					traveller('TWO', Option.some('Sam Lee'), Option.some('12A')),
					traveller('TWO', Option.some('Sam Lee'), Option.some('12B'))
				])
			])
		),
		expected
	)
	// The whole pass shared again changes nothing.
	assert.deepStrictEqual(
		upsert(passengers, [ticket(Array.flatMap(passengers, flight => flight.travellers))]),
		passengers
	)
})

it('moves a rebooked reservation to its new flight, keeping the id when nobody else was on the old one', () => {
	assert.deepStrictEqual(
		Array.map(
			upsert(
				[Flight.make({...FLIGHT, travellers: [traveller('TWO', Option.some('Bob Stone'), Option.some('11B'))]})],
				[ticket([traveller('TWO', Option.some('Bob Stone'), Option.none())], '543')]
			),
			flight => [flight.id, flight.number, flight.travellers]
		),
		[[FLIGHT.id, '543', [traveller('TWO', Option.some('Bob Stone'), Option.some('11B'))]]]
	)
})

it('updates the traveller a pass names on a flight joined from rows saved before names were read', () => {
	const joined = Flight.make({
		...FLIGHT,
		travellers: [
			traveller('ONE', Option.none(), Option.some('11A')),
			traveller('TWO', Option.none(), Option.some('11B'))
		]
	})
	assert.deepStrictEqual(
		seating(upsert([joined], [ticket([traveller('TWO', Option.some('Bob Stone'), Option.some('11B'))])])),
		[
			[
				'553',
				false,
				[
					['', '11A', 'ONE', 'confirmed'],
					['Bob Stone', '11B', 'TWO', 'confirmed']
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
