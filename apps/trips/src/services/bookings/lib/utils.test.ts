import {assert, it} from '@effect/vitest'

import {Array, DateTime, Option} from 'effect'

import {activeWindow, activityProps, HOUR, instantOf, MINUTE, upsert} from '#services/bookings/lib/utils.ts'
import {BookingId, Flight, Train} from '#services/bookings/schema.ts'

function at(iso: string) {
	return DateTime.toEpochMillis(DateTime.makeUnsafe(iso))
}

const DEPARTS = at('2026-10-28T15:40:00Z')

const FLIGHT = {
	airline: 'British Airways',
	airlineCode: 'BA',
	arrives: DEPARTS + 2.5 * HOUR,
	boardingAt: Option.none(),
	boardingGroup: Option.none(),
	confirmation: Option.none(),
	departs: DEPARTS,
	from: {city: 'Rome', code: 'FCO', name: 'Fiumicino', timeZone: 'Europe/Rome'},
	id: BookingId.make('7f0c8f8e-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
	live: Option.none(),
	number: '553',
	seat: Option.none(),
	status: 'confirmed',
	to: {city: 'London', code: 'LHR', name: 'Heathrow', timeZone: 'Europe/London'}
} as const

const TRAIN = {
	arrives: DEPARTS + 3 * HOUR,
	coach: Option.some('5'),
	confirmation: Option.none(),
	departs: DEPARTS,
	from: {name: 'Roma Termini', timeZone: 'Europe/Rome'},
	id: BookingId.make('1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'),
	live: Option.none(),
	number: '9541',
	operator: 'trenitalia',
	operatorName: 'Frecciarossa',
	seat: Option.none(),
	status: 'confirmed',
	to: {name: 'Milano Centrale', timeZone: 'Europe/Rome'}
} as const

const flight = Flight.make(FLIGHT)

it('reads a printed time in the place zone and an offset as given', () => {
	// Rome is on UTC+1 after the last Sunday of October.
	assert.deepStrictEqual(instantOf('2026-10-28T16:40', 'Europe/Rome'), Option.some(DEPARTS))
	assert.deepStrictEqual(instantOf('2026-07-01T09:00', 'Europe/London'), Option.some(at('2026-07-01T08:00:00Z')))
	assert.deepStrictEqual(instantOf('2026-10-28T17:40+02:00', 'Europe/London'), Option.some(DEPARTS))
	assert.deepStrictEqual(instantOf('2026-10-28T16:40:30.125', 'Europe/Rome'), Option.some(DEPARTS + 30_125))
})

it('merges a reservation seen again, keeps what the newer ticket leaves out, and keeps live data unless the service moved', () => {
	const tracked = Flight.make({
		...FLIGHT,
		confirmation: Option.some('ABC123'),
		live: Option.some({checkedAt: 1, departureGate: 'B12', state: 'scheduled' as const})
	})
	const again = {...FLIGHT, id: BookingId.make('aaaaaaaa-0d0a-4a5e-9d8f-5b2a1c3d4e5f'), seat: Option.some('14A')}
	assert.deepStrictEqual(
		Array.map(upsert([tracked], [Flight.make(again)]), booking => [
			booking.id,
			booking.confirmation,
			booking._tag === 'flight' && booking.seat,
			booking._tag === 'flight' && Option.map(booking.live, live => live.departureGate)
		]),
		[[FLIGHT.id, Option.some('ABC123'), Option.some('14A'), Option.some('B12')]]
	)
	assert.deepStrictEqual(
		Array.map(
			upsert([tracked], [Flight.make({...again, departs: DEPARTS + 3 * HOUR})]),
			booking => booking._tag === 'flight' && booking.live
		),
		[Option.none()]
	)

	assert.strictEqual(upsert([tracked], [Flight.make({...again, number: '555'})]).length, 2)
})

it('keeps the two legs of one flight number apart', () => {
	// BA15 flies London to Singapore, then on to Sydney under the same number and confirmation.
	const first = {...FLIGHT, confirmation: Option.some('ABC123'), number: '15'}
	const second = Flight.make({
		...first,
		departs: DEPARTS + 15 * HOUR,
		from: first.to,
		id: BookingId.make('bbbbbbbb-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
		to: {city: 'Sydney', code: 'SYD', name: 'Kingsford Smith', timeZone: 'Australia/Sydney'}
	})
	assert.strictEqual(upsert([Flight.make(first)], [second]).length, 2)
})

it('splits a flight longer than an activity may live into departure and arrival', () => {
	const long = Flight.make({...FLIGHT, arrives: DEPARTS + 11 * HOUR})
	assert.deepStrictEqual(
		Array.map([DEPARTS - HOUR, DEPARTS + 2 * HOUR], now => Option.map(activeWindow(flight, now), window => window.leg)),
		[Option.some('departure'), Option.some('departure')]
	)
	assert.deepStrictEqual(
		Array.map([DEPARTS - HOUR, DEPARTS + 4 * HOUR, DEPARTS + 10 * HOUR], now =>
			Option.map(activeWindow(long, now), window => window.leg)
		),
		[Option.some('departure'), Option.none(), Option.some('arrival')]
	)
})

it('words each flight phase for the island', () => {
	const leave = activityProps(flight, [], DEPARTS - 2.5 * HOUR)
	assert.deepStrictEqual(
		[leave.phase, leave.headline, leave.countdown, leave.symbol, leave.tone],
		['leave', 'Leave for FCO', DEPARTS - 2 * HOUR, 'car.fill', 'warn']
	)
	// Each end in its own zone, as the boarding pass prints it.
	assert.deepStrictEqual([leave.departureTime, leave.arrivalTime], ['16:40', '18:10'])

	const gate = activityProps(
		Flight.make({
			...FLIGHT,
			live: Option.some({checkedAt: 1, departureGate: 'B12', previousGate: 'A3', state: 'scheduled' as const})
		}),
		[],
		DEPARTS - 30 * MINUTE
	)
	assert.deepStrictEqual(
		[gate.phase, gate.chip, gate.detail, gate.tone],
		['gate', {text: 'B12', tone: 'warn'}, 'was A3', 'good']
	)

	const airborne = activityProps(
		Flight.make({
			...FLIGHT,
			live: Option.some({
				checkedAt: 1,
				departureActual: DEPARTS + 20 * MINUTE,
				state: 'airborne' as const,
				takeoffActual: DEPARTS + 30 * MINUTE
			})
		}),
		[],
		DEPARTS + HOUR
	)
	assert.deepStrictEqual(
		[airborne.headline, airborne.progressFrom, airborne.departureNote, airborne.tone, airborne.countdown],
		['Lands in', DEPARTS + 30 * MINUTE, 'Departed', 'info', DEPARTS + 2.5 * HOUR]
	)

	const landed = activityProps(
		Flight.make({...FLIGHT, live: Option.some({belt: '7', checkedAt: 1, state: 'arrived' as const})}),
		[],
		DEPARTS + 3 * HOUR
	)
	assert.deepStrictEqual(
		[landed.headline, landed.chip, landed.countdown, landed.label],
		['Bags on belt 7', {text: 'Belt 7', tone: 'plain'}, undefined, 'Landed']
	)
})

it('shows a changed platform and a late train', () => {
	const props = activityProps(
		Train.make({
			...TRAIN,
			live: Option.some({
				checkedAt: 1,
				delayMinutes: 4,
				departurePlatform: '12',
				departurePlatformPlanned: '9',
				state: 'scheduled' as const
			})
		}),
		[],
		DEPARTS - 10 * MINUTE
	)
	assert.deepStrictEqual(
		[props.phase, props.chip, props.tone, props.detail, props.countdown],
		['platform', {text: 'Bin 12', tone: 'warn'}, 'warn', 'Coach 5 · 4m late', DEPARTS + 4 * MINUTE]
	)

	// Once it left, the departure keeps the delay it left with and the label follows the delay it runs with.
	const running = activityProps(
		Train.make({
			...TRAIN,
			live: Option.some({
				arrivalPlatform: '7',
				checkedAt: 1,
				delayMinutes: 12,
				departureDelay: 5,
				state: 'departed' as const
			})
		}),
		[],
		DEPARTS + HOUR
	)
	assert.deepStrictEqual(
		[running.phase, running.departureTime, running.label, running.chip],
		['running', '16:45', '+12′', {text: 'Bin 7', tone: 'plain'}]
	)
})

it('keeps the timetable for a train running early before it leaves', () => {
	const early = activityProps(
		Train.make({
			...TRAIN,
			live: Option.some({checkedAt: 1, delayMinutes: -2, departurePlatform: '6', state: 'scheduled' as const})
		}),
		[],
		DEPARTS - 20 * MINUTE
	)
	assert.deepStrictEqual([early.departureTime, early.countdown], ['16:40', DEPARTS])
})

it('shows a cancelled train without a countdown', () => {
	const props = activityProps(Train.make({...TRAIN, status: 'cancelled'}), [], DEPARTS - 30 * MINUTE)
	assert.deepStrictEqual(
		[props.phase, props.headline, props.countdown, props.symbol, props.tone],
		['cancelled', 'Cancelled', undefined, 'exclamationmark.triangle.fill', 'bad']
	)
})
