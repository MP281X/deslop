import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Function, Option, Schema, String, Struct} from 'effect'

import {
	activeWindow,
	airportByOf,
	arrivalClockOf,
	daysBetween,
	instantOf,
	activityProps,
	cancelledOf,
	leaveByOf,
	upsert
} from '#services/flights/lib/utils.ts'
import type {FlightList, ReservationStatus, Traveller} from '#services/flights/schema.ts'
import {FlightId, Flight, FlightTracking, Place, PlaceCode, TravelTime} from '#services/flights/schema.ts'

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

it('wants him at the airport an hour before the booked departure, whatever the delay, and leaving the saved trip earlier', () => {
	const late = Flight.make({
		...FLIGHT,
		live: Option.some(
			Schema.decodeSync(FlightTracking)({
				checkedAt: DateTime.toEpochMillis(DEPARTS),
				departureEstimated: DateTime.toEpochMillis(DateTime.addDuration(DEPARTS, Duration.minutes(50))),
				state: 'scheduled'
			})
		)
	})
	const travel = [
		TravelTime.make({airport: PlaceCode.make('BGY'), minutes: 120}),
		TravelTime.make({airport: PlaceCode.make('FCO'), minutes: 45})
	]
	assert.deepStrictEqual(
		[airportByOf(late), leaveByOf(late, travel), leaveByOf(late, Array.take(travel, 1))],
		[
			DateTime.makeUnsafe('2026-10-28T14:40:00Z'),
			Option.some(DateTime.makeUnsafe('2026-10-28T13:55:00Z')),
			Option.none()
		]
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

function traveller(
	confirmation: string,
	name: Option.Option<string>,
	seat: Option.Option<string>,
	status: ReservationStatus = 'confirmed'
) {
	return {
		boardingGroup: Option.none(),
		boardingPass: false,
		confirmation: Option.some(confirmation),
		name,
		seat,
		status,
		ticket: Option.none()
	} satisfies Traveller
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

// Anna Bianchi on e-ticket 125 2345678901, in a given seat.
function anna(seat: string) {
	return {...traveller('XYZ789', Option.some('Anna Bianchi'), Option.some(seat)), ticket: Option.some('125-2345678901')}
}

// Alex Wu, of whom booking N1 holds two.
function alex(seat: Option.Option<string>) {
	return traveller('N1', Option.some('Alex Wu'), seat)
}

it('adds each traveller a ticket names to the flight under their own reservation', () => {
	// The flight saved before names were read is whoever sits in 14C under its code; a seat changed later stays with the e-ticket that holds it.
	assert.deepStrictEqual(
		seating(
			upsert(
				[Flight.make({...FLIGHT, travellers: [traveller('ABC123', Option.none(), Option.some('14C'))]})],
				[
					ticket([traveller('ABC123', Option.some('Matteo Rossi'), Option.some('014C'))]),
					ticket([anna('14D')]),
					ticket([{...anna('15A'), ticket: Option.some('1252345678901')}])
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

it('keeps two people of one name and code as two, on passes shared apart or one ticket without seats', () => {
	assert.deepStrictEqual(
		seating(upsert([], [ticket([alex(Option.some('15A'))]), ticket([alex(Option.some('15B'))])])),
		[
			[
				'553',
				false,
				[
					['Alex Wu', '15A', 'N1', 'confirmed'],
					['Alex Wu', '15B', 'N1', 'confirmed']
				]
			]
		]
	)
	const unseated = upsert([], [ticket([alex(Option.none()), alex(Option.none())])])
	assert.lengthOf(unseated[0]?.travellers ?? [], 2)
	// The same ticket shared again still holds two.
	assert.deepStrictEqual(upsert(unseated, [ticket([alex(Option.none()), alex(Option.none())])]), unseated)
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
	const rebooked = upsert(
		upsert(both, [ticket([traveller('TWO', Option.some('Bob Stone'), Option.some('20C'))], '543')]),
		[
			ticket(
				[traveller('TWO', Option.some('Bob Stone'), Option.none(), 'cancelled')],
				'553',
				DateTime.addDuration(DEPARTS, Duration.minutes(30))
			)
		]
	)
	// The flight he left no longer holds him, so its cancellation changes nothing.
	assert.deepStrictEqual(seating(rebooked), [
		['553', false, [['Alice Hart', '11A', 'ONE', 'confirmed']]],
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

it('changes nobody for a cancellation naming nobody without a code anyone on the flight holds', () => {
	const ada = upsert(
		[],
		[
			ticket([traveller('Y2', Option.some('Ada Byron'), Option.some('3A'))]),
			ticket([{...traveller('', Option.some('Grace Hopper'), Option.some('3B')), confirmation: Option.none()}])
		]
	)
	assert.deepStrictEqual(
		upsert(ada, [ticket([{...traveller('', Option.none(), Option.none(), 'cancelled'), confirmation: Option.none()}])]),
		ada
	)
	assert.deepStrictEqual(upsert(ada, [cancellation('NONE1')]), ada)
	// A cancellation that names nobody still covers the booking whose code it gives.
	assert.deepStrictEqual(seating(upsert(ada, [cancellation('Y2')])), [
		[
			'553',
			false,
			[
				['Ada Byron', '3A', 'Y2', 'cancelled'],
				['Grace Hopper', '3B', '', 'confirmed']
			]
		]
	])
})

it('saves no flight for a cancellation of travellers nobody holds', () => {
	assert.deepStrictEqual(
		upsert(
			[],
			[ticket([{...traveller('', Option.none(), Option.none(), 'cancelled'), confirmation: Option.none()}], '490')]
		),
		[]
	)
	assert.deepStrictEqual(
		upsert([], [ticket([traveller('ZZ9', Option.some('Ada Byron'), Option.none(), 'cancelled')])]),
		[]
	)
	// A flight others are on gains nobody from a cancellation naming someone it never held.
	const ada = upsert([], [ticket([traveller('Y2', Option.some('Ada Byron'), Option.some('3A'))])])
	assert.deepStrictEqual(
		upsert(ada, [ticket([traveller('Q7', Option.some('Grace Hopper'), Option.none(), 'cancelled')])]),
		ada
	)
})

it('finds a traveller by their e-ticket under a new booking code', () => {
	const recoded = upsert(
		[],
		[
			ticket([anna('14D')]),
			ticket([{...anna('014D'), confirmation: Option.some('NEW42'), ticket: Option.some('1252345678901')}])
		]
	)
	assert.deepStrictEqual(seating(recoded), [['553', false, [['Anna Bianchi', '014D', 'NEW42', 'confirmed']]]])
})

// Alex Kim, of whom booking TWINS holds two, each on an e-ticket of their own.
function kim(
	seat: Option.Option<string>,
	ticketNumber: Option.Option<string>,
	status: ReservationStatus = 'confirmed'
) {
	return {...traveller('TWINS', Option.some('Alex Kim'), seat, status), ticket: ticketNumber}
}

it('changes neither of two travellers of one name when a ticket could mean either', () => {
	const twins = upsert(
		[],
		[
			ticket([
				kim(Option.some('14A'), Option.some('1250000000001')),
				kim(Option.some('14B'), Option.some('125-0000000002'))
			])
		]
	)
	assert.deepStrictEqual(upsert(twins, [ticket([kim(Option.none(), Option.none(), 'cancelled')])]), twins)
	// The e-ticket says which one; a cancellation listing both cancels both.
	assert.deepStrictEqual(
		seating(upsert(twins, [ticket([kim(Option.none(), Option.some('125 0000000002'), 'cancelled')])])),
		[
			[
				'553',
				false,
				[
					['Alex Kim', '14A', 'TWINS', 'confirmed'],
					['Alex Kim', '14B', 'TWINS', 'cancelled']
				]
			]
		]
	)
	assert.isTrue(
		Array.every(
			upsert(twins, [
				ticket([kim(Option.none(), Option.none(), 'cancelled'), kim(Option.none(), Option.none(), 'cancelled')])
			]),
			cancelledOf
		)
	)
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

it('moves a rebooked traveller to the new service, a flight of its own that lends nothing of the old one', () => {
	const bob = {
		...traveller('TWO', Option.some('Bob Stone'), Option.some('11B')),
		boardingGroup: Option.some('2'),
		boardingPass: true
	}
	const boarding = {
		...FLIGHT,
		boardingAt: Option.some(DateTime.subtractDuration(DEPARTS, Duration.minutes(40))),
		live: Option.some(
			Schema.decodeSync(FlightTracking)({
				checkedAt: 1,
				departureGate: 'B12',
				departureTerminal: '3',
				state: 'scheduled'
			})
		)
	}
	// The new ticket prints no boarding time, seat or group, so the new flight has none of the old one's, nor its boarding pass, and its own id keeps the old flight's alerts and Live Activity apart.
	const unseated = traveller('TWO', Option.some('Bob Stone'), Option.none())
	assert.deepStrictEqual(
		Array.map(upsert([Flight.make({...boarding, travellers: [bob]})], [ticket([unseated], '543')]), flight => [
			flight.id,
			flight.number,
			flight.boardingAt,
			flight.live,
			flight.travellers
		]),
		[[ticket([], '543').id, '543', Option.none(), Option.none(), [unseated]]]
	)
	// Moved off a flight others stay on, he brings no seat either.
	assert.deepStrictEqual(
		seating(
			upsert(
				[
					Flight.make({...boarding, travellers: [traveller('ONE', Option.some('Alice Hart'), Option.some('11A')), bob]})
				],
				[ticket([unseated], '543')]
			)
		),
		[
			['553', false, [['Alice Hart', '11A', 'ONE', 'confirmed']]],
			['543', false, [['Bob Stone', '', 'TWO', 'confirmed']]]
		]
	)
})

it('moves only the travellers a rebooking names, and the whole booking only when it names nobody', () => {
	const shared = upsert(
		[],
		[
			ticket([
				traveller('AB', Option.some('Alice Hart'), Option.some('1A')),
				traveller('AB', Option.some('Bob Stone'), Option.some('1B'))
			]),
			ticket([traveller('C', Option.some('Carol Diaz'), Option.some('1C'))])
		]
	)
	const alice = upsert(shared, [ticket([traveller('AB', Option.some('Alice Hart'), Option.some('4A'))], '554')])
	const expected = [
		[
			'553',
			false,
			[
				['Bob Stone', '1B', 'AB', 'confirmed'],
				['Carol Diaz', '1C', 'C', 'confirmed']
			]
		],
		['554', false, [['Alice Hart', '4A', 'AB', 'confirmed']]]
	]
	assert.deepStrictEqual(seating(alice), expected)
	// Bob's pass for the flight he is still on moves nobody.
	assert.deepStrictEqual(
		seating(upsert(alice, [ticket([traveller('AB', Option.some('Bob Stone'), Option.some('1B'))])])),
		expected
	)
	// A schedule change naming nobody moves the whole booking, and only it.
	assert.deepStrictEqual(seating(upsert(shared, [ticket([traveller('AB', Option.none(), Option.none())], '554')])), [
		['553', false, [['Carol Diaz', '1C', 'C', 'confirmed']]],
		[
			'554',
			false,
			[
				['Alice Hart', '', 'AB', 'confirmed'],
				['Bob Stone', '', 'AB', 'confirmed']
			]
		]
	])
})

// A BA flight between two airports, its hours from DEPARTS, read under an id of its own.
function leg(travellers: readonly Traveller[], number: string, from: string, to: string, hours: number, length = 1.5) {
	return Flight.make({
		...FLIGHT,
		arrives: DateTime.addDuration(DEPARTS, Duration.hours(hours + length)),
		departs: DateTime.addDuration(DEPARTS, Duration.hours(hours)),
		from: Schema.decodeSync(Place)({code: from, name: from, timeZone: 'UTC'}),
		id: FlightId.make(
			`${String.padStart(4, '0')(number)}${String.padStart(4, '0')(`${hours}`)}-0d0a-4a5e-9d8f-5b2a1c3d4e5f`
		),
		number,
		to: Schema.decodeSync(Place)({code: to, name: to, timeZone: 'UTC'}),
		travellers
	})
}

// Bob Stone on e-ticket 125 1111111111 under booking RTN.
function stone(seat: Option.Option<string>) {
	return {...traveller('RTN', Option.some('Bob Stone'), seat), ticket: Option.some('1251111111111')}
}

// Bob Stone on the same e-ticket under Ryanair's booking FR1.
function ryan(seat: Option.Option<string>) {
	return {...stone(seat), confirmation: Option.some('FR1')}
}

it('moves nobody off another leg of the booking on a pass for one leg', () => {
	// BA 450 on the 21st, its return BA 451 that evening, and BA 450 again on the 22nd.
	const journey = upsert(
		[],
		[
			leg([stone(Option.some('14A'))], '450', 'LHR', 'EDI', 0),
			leg([stone(Option.none())], '451', 'EDI', 'LHR', 5),
			leg([stone(Option.none())], '450', 'LHR', 'EDI', 24)
		]
	)
	assert.deepStrictEqual(upsert(journey, [leg([stone(Option.some('14A'))], '450', 'LHR', 'EDI', 0)]), journey)
	// A confirmation of the whole new journey moves him off the flight it lacks.
	assert.deepStrictEqual(
		Array.map(
			upsert(journey, [
				leg([stone(Option.none())], '450', 'LHR', 'EDI', 24),
				leg([stone(Option.none())], '451', 'EDI', 'LHR', 30)
			]),
			flight => [flight.number, flight.departs, flight.travellers.length]
		),
		[
			['450', DateTime.addDuration(DEPARTS, Duration.hours(24)), 1],
			['451', DateTime.addDuration(DEPARTS, Duration.hours(30)), 1]
		]
	)
})

it('moves a traveller one e-ticket identifies onto a flight sharing either airport, unless one leads into the other', () => {
	const stansted = [leg([ryan(Option.some('3A'))], '1234', 'BGY', 'STN', 0, 2)]
	assert.deepStrictEqual(seating(upsert(stansted, [leg([ryan(Option.none())], '8810', 'STN', 'CDG', 1)])), [
		['8810', false, [['Bob Stone', '', 'FR1', 'confirmed']]]
	])
	// Leaving after he lands is his connection, and the first leg stays.
	assert.lengthOf(upsert(stansted, [leg([ryan(Option.some('9C'))], '8810', 'STN', 'CDG', 3)]), 2)
	// A first leg rebooked to the next day leaves the connection it no longer reaches to its own ticket.
	assert.lengthOf(
		upsert(
			[leg([ryan(Option.some('3A'))], '206', 'STN', 'DUB', 3)],
			[leg([ryan(Option.none())], '777', 'BGY', 'STN', 24, 2)]
		),
		2
	)
})

it('moves only the traveller a rebooking identifies, and neither of two it could mean', () => {
	const twins = upsert(
		[],
		[
			ticket(
				[kim(Option.some('14A'), Option.some('1250000000001')), kim(Option.some('14B'), Option.some('125-0000000002'))],
				'410'
			)
		]
	)
	assert.deepStrictEqual(seating(upsert(twins, [ticket([kim(Option.none(), Option.some('1250000000001'))], '411')])), [
		['410', false, [['Alex Kim', '14B', 'TWINS', 'confirmed']]],
		['411', false, [['Alex Kim', '', 'TWINS', 'confirmed']]]
	])
	assert.deepStrictEqual(
		Array.map(upsert(twins, [ticket([kim(Option.none(), Option.none())], '411')]), flight => [
			flight.number,
			flight.travellers.length
		]),
		[
			['410', 2],
			['411', 1]
		]
	)
})

it('reinstates a cancelled traveller only on a ticket naming them', () => {
	const sam = traveller('KIM1', Option.some('Sam Kim'), Option.some('7B'), 'cancelled')
	const held = [
		Flight.make({...FLIGHT, travellers: [traveller('KIM1', Option.some('Jo Kim'), Option.some('7A')), sam]})
	]
	const booking = traveller('KIM1', Option.none(), Option.none())
	assert.deepStrictEqual(seating(upsert(held, [ticket([booking], '554')])), [
		['553', true, [['Sam Kim', '7B', 'KIM1', 'cancelled']]],
		['554', false, [['Jo Kim', '', 'KIM1', 'confirmed']]]
	])
	assert.deepStrictEqual(upsert(held, [ticket([booking])]), held)
})

it('keeps every segment of one ticket, even two on one route', () => {
	const multi = [
		ticket([traveller('MULTI', Option.none(), Option.none())], '901', DateTime.makeUnsafe('2026-12-03T09:00:00Z')),
		ticket([traveller('MULTI', Option.none(), Option.none())], '902', DateTime.makeUnsafe('2026-12-07T09:00:00Z'))
	]
	const saved = upsert([], multi)
	assert.deepStrictEqual(
		Array.map(saved, flight => flight.number),
		['901', '902']
	)
	assert.deepStrictEqual(upsert(saved, multi), saved)
	// A pass for one of them, days from the other, replaces neither.
	assert.deepStrictEqual(
		Array.map(
			upsert(saved, [
				ticket(
					[traveller('MULTI', Option.some('Ada Byron'), Option.some('2C'))],
					'902',
					DateTime.makeUnsafe('2026-12-07T09:00:00Z')
				)
			]),
			flight => flight.number
		),
		['901', '902']
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

it('keeps one flight number on two local dates as two services, however close in hours', () => {
	// 21:00 on 1 December and 16:00 on 2 December in Rome, nineteen hours apart.
	const services = upsert(
		[],
		[
			ticket(
				[traveller('DAY1', Option.some('Ada Byron'), Option.some('3A'))],
				'801',
				DateTime.makeUnsafe('2026-12-01T20:00:00Z')
			)
		]
	)
	assert.deepStrictEqual(
		seating(
			upsert(services, [
				ticket(
					[traveller('DAY2', Option.some('Ada Byron'), Option.some('3A'))],
					'801',
					DateTime.makeUnsafe('2026-12-02T15:00:00Z')
				)
			])
		),
		[
			['801', false, [['Ada Byron', '3A', 'DAY1', 'confirmed']]],
			['801', false, [['Ada Byron', '3A', 'DAY2', 'confirmed']]]
		]
	)
	// The same evening's ticket, printed with another hour, is still that service.
	assert.lengthOf(
		upsert(services, [
			ticket(
				[traveller('DAY1', Option.some('Ada Byron'), Option.some('3A'))],
				'801',
				DateTime.makeUnsafe('2026-12-01T22:30:00Z')
			)
		]),
		1
	)
})

it('keeps distinct legs of the same flight number as distinct flights', () => {
	const held = Flight.make({...FLIGHT, travellers: [traveller('ONE', Option.some('Ada Byron'), Option.none())]})
	assert.lengthOf(
		upsert(
			[held],
			[
				Flight.make({
					...FLIGHT,
					departs: DateTime.addDuration(DEPARTS, Duration.hours(15)),
					from: FLIGHT.to,
					id: FlightId.make('bbbbbbbb-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
					to: FLIGHT.from,
					travellers: held.travellers
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
