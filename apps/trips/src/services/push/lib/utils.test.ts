import {assert, it} from '@effect/vitest'

import {Array, DateTime, Option} from 'effect'

import {HOUR, MINUTE} from '#services/bookings/lib/utils.ts'
import {BookingId, Flight, Train} from '#services/bookings/schema.ts'
import {alertsOf} from '#services/push/lib/utils.ts'

const DEPARTS = DateTime.toEpochMillis(DateTime.makeUnsafe('2026-10-28T15:40:00Z'))

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

it('announces a cancelled train', () => {
	assert.deepStrictEqual(
		Array.map(alertsOf(Train.make({...TRAIN, status: 'cancelled'}), DEPARTS - HOUR), alert => alert.category),
		['cancelled']
	)
})

it('announces gate changes, delays in steps and cancellations once each', () => {
	const late = {
		...FLIGHT,
		live: Option.some({
			checkedAt: 1,
			departureEstimated: DEPARTS + 20 * MINUTE,
			departureGate: 'B12',
			previousGate: 'A3',
			state: 'scheduled' as const
		})
	}
	assert.deepStrictEqual(
		Array.map(alertsOf(Flight.make(late), DEPARTS - HOUR), alert => [alert.category, alert.value, alert.body]),
		[
			['gate', 'B12', 'Changed from A3'],
			['delay', '15', 'Now departs 17:00']
		]
	)
	assert.deepStrictEqual(
		Array.map(alertsOf(Flight.make({...late, status: 'cancelled'}), DEPARTS - HOUR), alert => [
			alert.category,
			alert.value
		]),
		[
			['cancelled', undefined],
			['gate', 'B12']
		]
	)
	assert.deepStrictEqual(alertsOf(Flight.make(FLIGHT), DEPARTS - 40 * HOUR), [])
})
