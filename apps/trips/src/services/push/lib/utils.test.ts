import {assert, it} from '@effect/vitest'

import {Array, DateTime} from 'effect'

import {HOUR, MINUTE} from '#services/bookings/lib/utils.ts'
import {Flight, Train} from '#services/bookings/schema.ts'
import {alertsFor} from '#services/push/lib/utils.ts'

const DEPARTS = DateTime.toEpochMillis(DateTime.makeUnsafe('2026-10-28T15:40:00Z'))

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

it('announces a cancelled train', () => {
	assert.deepStrictEqual(
		Array.map(alertsFor(Train.make({...train, status: 'cancelled'}), DEPARTS - HOUR), alert => alert.category),
		['cancelled']
	)
})

it('announces gate changes, delays in steps and cancellations once each', () => {
	const late = {
		...flight,
		live: {
			checkedAt: 1,
			departureEstimated: DEPARTS + 20 * MINUTE,
			departureGate: 'B12',
			previousGate: 'A3',
			state: 'scheduled' as const
		}
	}
	assert.deepStrictEqual(
		Array.map(alertsFor(late, DEPARTS - HOUR), alert => [alert.category, alert.value, alert.body]),
		[
			['gate', 'B12', 'Changed from A3'],
			['delay', '15', 'Now departs 17:00']
		]
	)
	assert.deepStrictEqual(
		Array.map(alertsFor({...late, status: 'cancelled'}, DEPARTS - HOUR), alert => [alert.category, alert.value]),
		[
			['cancelled', undefined],
			['gate', 'B12']
		]
	)
	assert.deepStrictEqual(alertsFor(flight, DEPARTS - 40 * HOUR), [])
})
