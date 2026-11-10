import {assert, it} from '@effect/vitest'

import {Array, DateTime, Option} from 'effect'

import {activeWindow, activityProps, HOUR, instantOf, MINUTE, upsert} from '#services/bookings/lib/utils.ts'
import {Flight, Train} from '#services/bookings/schema.ts'

function at(iso: string) {
	return DateTime.toEpochMillis(DateTime.makeUnsafe(iso))
}

const DEPARTS = at('2026-10-28T15:40:00Z')

const flight = Flight.make({
	airline: 'British Airways',
	airlineCode: 'BA',
	arrives: DEPARTS + 2.5 * HOUR,
	departs: DEPARTS,
	from: {city: 'Rome', code: 'FCO', name: 'Fiumicino', timeZone: 'Europe/Rome'},
	id: '7f0c8f8e-0d0a-4a5e-9d8f-5b2a1c3d4e5f',
	number: '553',
	status: 'confirmed',
	to: {city: 'London', code: 'LHR', name: 'Heathrow', timeZone: 'Europe/London'}
})

const train = Train.make({
	arrives: DEPARTS + 3 * HOUR,
	coach: '5',
	departs: DEPARTS,
	from: {name: 'Roma Termini', timeZone: 'Europe/Rome'},
	id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
	number: '9541',
	operator: 'trenitalia',
	operatorName: 'Frecciarossa',
	status: 'confirmed',
	to: {name: 'Milano Centrale', timeZone: 'Europe/Rome'}
})

it('reads a printed time in the place zone and an offset as given', () => {
	// Rome is on UTC+1 after the last Sunday of October.
	assert.deepStrictEqual(instantOf('2026-10-28T16:40', 'Europe/Rome'), Option.some(DEPARTS))
	assert.deepStrictEqual(instantOf('2026-07-01T09:00', 'Europe/London'), Option.some(at('2026-07-01T08:00:00Z')))
	assert.deepStrictEqual(instantOf('2026-10-28T17:40+02:00', 'Europe/London'), Option.some(DEPARTS))
	assert.deepStrictEqual(instantOf('2026-10-28T16:40:30.125', 'Europe/Rome'), Option.some(DEPARTS + 30_125))
})

it('merges a reservation seen again and keeps live data unless the service moved', () => {
	const tracked = {...flight, live: {checkedAt: 1, departureGate: 'B12', state: 'scheduled' as const}}
	const again = Flight.make({...flight, id: 'aaaaaaaa-0d0a-4a5e-9d8f-5b2a1c3d4e5f', seat: '14A'})
	assert.deepStrictEqual(
		Array.map(upsert([tracked], [again]), booking => [
			booking.id,
			booking._tag === 'flight' && booking.seat,
			booking._tag === 'flight' && booking.live?.departureGate
		]),
		[[flight.id, '14A', 'B12']]
	)
	assert.deepStrictEqual(
		Array.map(
			upsert([tracked], [Flight.make({...again, departs: DEPARTS + 3 * HOUR})]),
			booking => booking._tag === 'flight' && booking.live
		),
		[undefined]
	)

	assert.strictEqual(upsert([tracked], [Flight.make({...again, number: '555'})]).length, 2)
})

it('keeps the two legs of one flight number apart', () => {
	// BA15 flies London to Singapore, then on to Sydney under the same number and confirmation.
	const first = Flight.make({...flight, confirmation: 'ABC123', number: '15'})
	const second = Flight.make({
		...first,
		departs: DEPARTS + 15 * HOUR,
		from: first.to,
		id: 'bbbbbbbb-0d0a-4a5e-9d8f-5b2a1c3d4e5f',
		to: {city: 'Sydney', code: 'SYD', name: 'Kingsford Smith', timeZone: 'Australia/Sydney'}
	})
	assert.strictEqual(upsert([first], [second]).length, 2)
})

it('splits a flight longer than an activity may live into departure and arrival', () => {
	const long = Flight.make({...flight, arrives: DEPARTS + 11 * HOUR})
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
		{...flight, live: {checkedAt: 1, departureGate: 'B12', previousGate: 'A3', state: 'scheduled'}},
		[],
		DEPARTS - 30 * MINUTE
	)
	assert.deepStrictEqual(
		[gate.phase, gate.chip, gate.detail, gate.tone],
		['gate', {text: 'B12', tone: 'warn'}, 'was A3', 'good']
	)

	const airborne = activityProps(
		{
			...flight,
			live: {
				checkedAt: 1,
				departureActual: DEPARTS + 20 * MINUTE,
				state: 'airborne',
				takeoffActual: DEPARTS + 30 * MINUTE
			}
		},
		[],
		DEPARTS + HOUR
	)
	assert.deepStrictEqual(
		[airborne.headline, airborne.progressFrom, airborne.departureNote, airborne.tone, airborne.countdown],
		['Lands in', DEPARTS + 30 * MINUTE, 'Departed', 'info', DEPARTS + 2.5 * HOUR]
	)

	const landed = activityProps({...flight, live: {belt: '7', checkedAt: 1, state: 'arrived'}}, [], DEPARTS + 3 * HOUR)
	assert.deepStrictEqual(
		[landed.headline, landed.chip, landed.countdown, landed.label],
		['Bags on belt 7', {text: 'Belt 7', tone: 'plain'}, undefined, 'Landed']
	)
})

it('shows a changed platform and a late train', () => {
	const props = activityProps(
		{
			...train,
			live: {checkedAt: 1, delayMinutes: 4, departurePlatform: '12', departurePlatformPlanned: '9', state: 'scheduled'}
		},
		[],
		DEPARTS - 10 * MINUTE
	)
	assert.deepStrictEqual(
		[props.phase, props.chip, props.tone, props.detail, props.countdown],
		['platform', {text: 'Bin 12', tone: 'warn'}, 'warn', 'Coach 5 · 4m late', DEPARTS + 4 * MINUTE]
	)

	// Once it left, the departure keeps the delay it left with and the label follows the delay it runs with.
	const running = activityProps(
		{...train, live: {arrivalPlatform: '7', checkedAt: 1, delayMinutes: 12, departureDelay: 5, state: 'departed'}},
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
		{...train, live: {checkedAt: 1, delayMinutes: -2, departurePlatform: '6', state: 'scheduled'}},
		[],
		DEPARTS - 20 * MINUTE
	)
	assert.deepStrictEqual([early.departureTime, early.countdown], ['16:40', DEPARTS])
})

it('shows a cancelled train without a countdown', () => {
	const props = activityProps(Train.make({...train, status: 'cancelled'}), [], DEPARTS - 30 * MINUTE)
	assert.deepStrictEqual(
		[props.phase, props.headline, props.countdown, props.symbol, props.tone],
		['cancelled', 'Cancelled', undefined, 'exclamationmark.triangle.fill', 'bad']
	)
})
