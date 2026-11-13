import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Option, Schema, Struct} from 'effect'

import {activeWindow, activityProps, instantOf, upsert} from '#services/bookings/lib/utils.ts'
import {ActivityProps, BookingId, Flight, FlightTracking, Train, TrainTracking} from '#services/bookings/schema.ts'

const DEPARTS = DateTime.makeUnsafe('2026-10-28T15:40:00Z')
const flight = Schema.decodeSync(Flight.json)({
	_tag: 'flight',
	airline: 'British Airways',
	airlineCode: 'BA',
	arrives: DateTime.toEpochMillis(DateTime.addDuration(DEPARTS, Duration.hours(2.5))),
	departs: DateTime.toEpochMillis(DEPARTS),
	from: {city: 'Rome', code: 'FCO', name: 'Fiumicino', timeZone: 'Europe/Rome'},
	id: '7f0c8f8e-0d0a-4a5e-9d8f-5b2a1c3d4e5f',
	number: '553',
	status: 'confirmed',
	to: {city: 'London', code: 'LHR', name: 'Heathrow', timeZone: 'Europe/London'}
})
const train = Schema.decodeSync(Train.json)({
	_tag: 'train',
	arrives: DateTime.toEpochMillis(DateTime.addDuration(DEPARTS, Duration.hours(3))),
	coach: '5',
	departs: DateTime.toEpochMillis(DEPARTS),
	from: {name: 'Roma Termini', timeZone: 'Europe/Rome'},
	id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
	number: '9541',
	operator: 'trenitalia',
	operatorName: 'Frecciarossa',
	status: 'confirmed',
	to: {name: 'Milano Centrale', timeZone: 'Europe/Rome'}
})

it('reads a printed time in the place zone and an offset as given', () => {
	assert.deepStrictEqual(instantOf('2026-10-28T16:40', 'Europe/Rome'), Option.some(DEPARTS))
	assert.deepStrictEqual(
		instantOf('2026-07-01T09:00', 'Europe/London'),
		Option.some(DateTime.makeUnsafe('2026-07-01T08:00:00Z'))
	)
	assert.deepStrictEqual(instantOf('2026-10-28T17:40+02:00', 'Europe/London'), Option.some(DEPARTS))
	assert.deepStrictEqual(
		instantOf('2026-10-28T16:40:30.125', 'Europe/Rome'),
		Option.some(DateTime.addDuration(DEPARTS, Duration.millis(30_125)))
	)
})

it('merges a reservation seen again, keeps what the newer ticket leaves out, and keeps live data unless the service moved', () => {
	const tracked = Flight.make({
		...flight,
		confirmation: Option.some('ABC123'),
		live: Option.some(Schema.decodeSync(FlightTracking)({checkedAt: 1, departureGate: 'B12', state: 'scheduled'}))
	})
	const again = Flight.make({
		...flight,
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
		[[flight.id, Option.some('ABC123'), Option.some('14A'), Option.some('B12')]]
	)
	assert.deepStrictEqual(
		Array.map(
			upsert(
				[tracked],
				[
					Flight.make({
						...Struct.pick(again, Struct.keys(Flight.fields)),
						departs: DateTime.addDuration(DEPARTS, Duration.hours(3))
					})
				]
			),
			booking => booking._tag === 'flight' && booking.live
		),
		[Option.none()]
	)
	assert.strictEqual(
		upsert([tracked], [Flight.make({...Struct.pick(again, Struct.keys(Flight.fields)), number: '555'})]).length,
		2
	)
})

it('keeps the two legs of one flight number apart', () => {
	const first = Flight.make({...flight, confirmation: Option.some('ABC123'), number: '15'})
	const second = Flight.make({
		...Struct.pick(first, Struct.keys(Flight.fields)),
		departs: DateTime.addDuration(DEPARTS, Duration.hours(15)),
		from: first.to,
		id: BookingId.make('bbbbbbbb-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
		to: Schema.decodeSync(Flight.json.fields.to)({
			city: 'Sydney',
			code: 'SYD',
			name: 'Kingsford Smith',
			timeZone: 'Australia/Sydney'
		})
	})
	assert.strictEqual(upsert([first], [second]).length, 2)
})

it('splits a flight longer than an activity may live into departure and arrival', () => {
	const long = Flight.make({...flight, arrives: DateTime.addDuration(DEPARTS, Duration.hours(11))})
	assert.deepStrictEqual(
		Array.map([-1, 2], hours =>
			Option.map(activeWindow(flight, DateTime.addDuration(DEPARTS, Duration.hours(hours))), window => window.leg)
		),
		[Option.some('departure'), Option.some('departure')]
	)
	assert.deepStrictEqual(
		Array.map([-1, 4, 10], hours =>
			Option.map(activeWindow(long, DateTime.addDuration(DEPARTS, Duration.hours(hours))), window => window.leg)
		),
		[Option.some('departure'), Option.none(), Option.some('arrival')]
	)
})

it('words each flight phase for the island', () => {
	const leave = Schema.encodeSync(ActivityProps)(
		activityProps(flight, [], DateTime.subtractDuration(DEPARTS, Duration.hours(2.5)))
	)
	assert.deepStrictEqual(
		[leave.phase, leave.headline, leave.countdown, leave.symbol, leave.tone],
		[
			'leave',
			'Leave for FCO',
			DateTime.toEpochMillis(DateTime.subtractDuration(DEPARTS, Duration.hours(2))),
			'car.fill',
			'warn'
		]
	)
	assert.deepStrictEqual([leave.departureTime, leave.arrivalTime], ['16:40', '18:10'])
	const gate = Schema.encodeSync(ActivityProps)(
		activityProps(
			Flight.make({
				...flight,
				live: Option.some(
					Schema.decodeSync(FlightTracking)({
						checkedAt: 1,
						departureGate: 'B12',
						previousGate: 'A3',
						state: 'scheduled'
					})
				)
			}),
			[],
			DateTime.subtractDuration(DEPARTS, Duration.minutes(30))
		)
	)
	assert.deepStrictEqual(
		[gate.phase, gate.chip, gate.detail, gate.tone],
		['gate', {text: 'B12', tone: 'warn'}, 'was A3', 'good']
	)
	const airborne = Schema.encodeSync(ActivityProps)(
		activityProps(
			Flight.make({
				...flight,
				live: Option.some(
					Schema.decodeSync(FlightTracking)({
						checkedAt: 1,
						departureActual: DateTime.toEpochMillis(DateTime.addDuration(DEPARTS, Duration.minutes(20))),
						state: 'airborne',
						takeoffActual: DateTime.toEpochMillis(DateTime.addDuration(DEPARTS, Duration.minutes(30)))
					})
				)
			}),
			[],
			DateTime.addDuration(DEPARTS, Duration.hours(1))
		)
	)
	assert.deepStrictEqual(
		[airborne.headline, airborne.progressFrom, airborne.departureNote, airborne.tone, airborne.countdown],
		[
			'Lands in',
			DateTime.toEpochMillis(DateTime.addDuration(DEPARTS, Duration.minutes(30))),
			'Departed',
			'info',
			DateTime.toEpochMillis(flight.arrives)
		]
	)
	const landed = Schema.encodeSync(ActivityProps)(
		activityProps(
			Flight.make({
				...flight,
				live: Option.some(Schema.decodeSync(FlightTracking)({belt: '7', checkedAt: 1, state: 'arrived'}))
			}),
			[],
			DateTime.addDuration(DEPARTS, Duration.hours(3))
		)
	)
	assert.deepStrictEqual(
		[landed.headline, landed.chip, landed.countdown, landed.label],
		['Bags on belt 7', {text: 'Belt 7', tone: 'plain'}, undefined, 'Landed']
	)
})

it('shows a changed platform and a late train', () => {
	const props = Schema.encodeSync(ActivityProps)(
		activityProps(
			Train.make({
				...train,
				live: Option.some(
					Schema.decodeSync(TrainTracking)({
						checkedAt: 1,
						delayMinutes: 4,
						departurePlatform: '12',
						departurePlatformPlanned: '9',
						state: 'scheduled'
					})
				)
			}),
			[],
			DateTime.subtractDuration(DEPARTS, Duration.minutes(10))
		)
	)
	assert.deepStrictEqual(
		[props.phase, props.chip, props.tone, props.detail, props.countdown],
		[
			'platform',
			{text: 'Bin 12', tone: 'warn'},
			'warn',
			'Coach 5 · 4m late',
			DateTime.toEpochMillis(DateTime.addDuration(DEPARTS, Duration.minutes(4)))
		]
	)
	const running = Schema.encodeSync(ActivityProps)(
		activityProps(
			Train.make({
				...train,
				live: Option.some(
					Schema.decodeSync(TrainTracking)({
						arrivalPlatform: '7',
						checkedAt: 1,
						delayMinutes: 12,
						departureDelay: 5,
						state: 'departed'
					})
				)
			}),
			[],
			DateTime.addDuration(DEPARTS, Duration.hours(1))
		)
	)
	assert.deepStrictEqual(
		[running.phase, running.departureTime, running.label, running.chip],
		['running', '16:45', '+12′', {text: 'Bin 7', tone: 'plain'}]
	)
})

it('keeps the timetable for a train running early before it leaves', () => {
	const early = Schema.encodeSync(ActivityProps)(
		activityProps(
			Train.make({
				...train,
				live: Option.some(
					Schema.decodeSync(TrainTracking)({checkedAt: 1, delayMinutes: -2, departurePlatform: '6', state: 'scheduled'})
				)
			}),
			[],
			DateTime.subtractDuration(DEPARTS, Duration.minutes(20))
		)
	)
	assert.deepStrictEqual([early.departureTime, early.countdown], ['16:40', DateTime.toEpochMillis(DEPARTS)])
})

it('shows a cancelled train without a countdown', () => {
	const props = Schema.encodeSync(ActivityProps)(
		activityProps(
			Train.make({...train, status: 'cancelled'}),
			[],
			DateTime.subtractDuration(DEPARTS, Duration.minutes(30))
		)
	)
	assert.deepStrictEqual(
		[props.phase, props.headline, props.countdown, props.symbol, props.tone],
		['cancelled', 'Cancelled', undefined, 'exclamationmark.triangle.fill', 'bad']
	)
})
