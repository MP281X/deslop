import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Option, Redacted, Schema, String} from 'effect'

import {ApnsToken} from '@deslop/runtime/shared/apns'

import {activityProps} from '#services/bookings/lib/utils.ts'
import {BookingId, Flight, FlightTracking} from '#services/bookings/schema.ts'
import {alertKey, alertsOf, announced, expiredActivities, holds, showPlan} from '#services/push/lib/utils.ts'
import {Activity, ChannelId, Device} from '#services/push/schema.ts'

const DEPARTS = DateTime.makeUnsafe('2026-10-28T15:40:00Z')
const FLIGHT = Schema.decodeSync(Flight.json)({
	_tag: 'flight',
	airline: 'British Airways',
	airlineCode: 'BA',
	arrives: DateTime.toEpochMillis(DateTime.addDuration(DEPARTS, Duration.hours(2.5))),
	departs: DateTime.toEpochMillis(DEPARTS),
	from: {code: 'FCO', name: 'Fiumicino', timeZone: 'Europe/Rome'},
	id: '7f0c8f8e-0d0a-4a5e-9d8f-5b2a1c3d4e5f',
	number: '553',
	status: 'confirmed',
	to: {code: 'LHR', name: 'Heathrow', timeZone: 'Europe/London'}
})
const STARTER = {
	bundle: 'xyz.mp281x.trips' as const,
	kind: 'start' as const,
	token: Redacted.make(ApnsToken.make(String.repeat(32)('a')))
}
const ACTIVITY = {
	bookingId: FLIGHT.id,
	bundle: 'xyz.mp281x.trips' as const,
	channel: ChannelId.make('current'),
	endedAt: Option.none<DateTime.Utc>(),
	leg: 'departure' as const,
	props: activityProps(FLIGHT, [], DEPARTS),
	startedAt: DEPARTS
}

it('announces a gate change and a fifteen-minute delay once each', () => {
	const alerts = alertsOf(
		Flight.make({
			...FLIGHT,
			live: Option.some(
				Schema.decodeSync(FlightTracking)({
					checkedAt: 1,
					departureEstimated: DateTime.toEpochMillis(DateTime.addDuration(DEPARTS, Duration.minutes(20))),
					departureGate: 'B12',
					previousGate: 'A3',
					state: 'scheduled'
				})
			)
		}),
		DateTime.subtractDuration(DEPARTS, Duration.hours(1))
	)
	assert.deepStrictEqual(Array.map(alerts, alertKey), ['gate:B12', 'delay:15'])
	assert.deepStrictEqual(
		Array.map(alerts, alert => announced(['gate:B12', 'delay:15'], alert)),
		[true, true]
	)
})

it('reannounces a gate returning to an earlier value but remembers every delay step', () => {
	const gate = {body: '', category: 'gate' as const, title: '', value: 'B12'}
	const delay = {body: '', category: 'delay' as const, title: '', value: '15'}
	assert.isFalse(announced(['gate:B12', 'gate:A3'], gate))
	assert.isTrue(announced(['gate:A3', 'gate:B12'], gate))
	assert.isTrue(announced(['delay:15', 'delay:30'], delay))
	assert.isFalse(announced(['delay:30'], delay))
})

it('refreshes a covering activity or launches a new one per app while an ended leg stays ended', () => {
	const window = {end: DateTime.addDuration(DEPARTS, Duration.hours(1)), leg: 'departure' as const, start: DEPARTS}
	assert.isTrue(holds(Activity.make(ACTIVITY), window))
	assert.isFalse(
		holds(Activity.make({...ACTIVITY, startedAt: DateTime.subtractDuration(DEPARTS, Duration.hours(8))}), window)
	)
	assert.isFalse(
		holds(
			Activity.make({...ACTIVITY, endedAt: Option.some(DateTime.subtractDuration(DEPARTS, Duration.seconds(1)))}),
			window
		)
	)
	const ended = Activity.make({
		...ACTIVITY,
		bundle: 'xyz.mp281x.trips.dev',
		channel: ChannelId.make('ended'),
		endedAt: Option.some(DEPARTS)
	})
	assert.deepStrictEqual(
		Array.map(
			showPlan(
				[Device.make(STARTER), Device.make({...STARTER, bundle: 'xyz.mp281x.trips.dev'})],
				[Activity.make(ACTIVITY), ended],
				FLIGHT,
				window
			),
			action => [action._tag, action.target.bundle]
		),
		[['refresh', 'xyz.mp281x.trips']]
	)
	assert.deepStrictEqual(
		Array.map(showPlan([Device.make(STARTER)], [], FLIGHT, window), action => action._tag),
		['launch']
	)
})

it('ends only running activities whose booking or current leg is gone', () => {
	const removed = Activity.make({
		...ACTIVITY,
		bookingId: BookingId.make('aaaaaaaa-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
		channel: ChannelId.make('removed')
	})
	const wrongLeg = Activity.make({...ACTIVITY, channel: ChannelId.make('wrong-leg'), leg: 'arrival'})
	const ended = Activity.make({...ACTIVITY, channel: ChannelId.make('ended'), endedAt: Option.some(DEPARTS)})
	assert.deepStrictEqual(
		Array.map(
			expiredActivities([Activity.make(ACTIVITY), removed, wrongLeg, ended], [FLIGHT], DEPARTS),
			activity => activity.channel
		),
		['removed', 'wrong-leg']
	)
})
