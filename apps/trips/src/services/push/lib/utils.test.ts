import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Option, Schema, Struct} from 'effect'

import {Flight, FlightTracking} from '#services/bookings/schema.ts'
import {alertsOf} from '#services/push/lib/utils.ts'

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

it('announces gate changes, delays in steps and cancellations once each', () => {
	const late = Flight.make({
		...flight,
		live: Option.some(
			Schema.decodeSync(FlightTracking)({
				checkedAt: 1,
				departureEstimated: DateTime.toEpochMillis(DateTime.addDuration(DEPARTS, Duration.minutes(20))),
				departureGate: 'B12',
				previousGate: 'A3',
				state: 'scheduled'
			})
		)
	})
	assert.deepStrictEqual(
		Array.map(alertsOf(late, DateTime.subtractDuration(DEPARTS, Duration.hours(1))), alert => [
			alert.category,
			alert.value,
			alert.body
		]),
		[
			['gate', 'B12', 'Changed from A3'],
			['delay', '15', 'Now departs 17:00']
		]
	)
	assert.deepStrictEqual(
		Array.map(
			alertsOf(
				Flight.make({...Struct.pick(late, Struct.keys(Flight.fields)), status: 'cancelled'}),
				DateTime.subtractDuration(DEPARTS, Duration.hours(1))
			),
			alert => [alert.category, alert.value]
		),
		[
			['cancelled', undefined],
			['gate', 'B12']
		]
	)
	assert.deepStrictEqual(alertsOf(flight, DateTime.subtractDuration(DEPARTS, Duration.hours(40))), [])
})
