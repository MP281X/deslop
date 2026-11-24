import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Option, Redacted, Schema, String, Struct, pipe} from 'effect'

import {ApnsToken, Device} from '@deslop/runtime/shared/apns'

import {activityProps} from '#services/flights/lib/utils.ts'
import {FlightId, Flight, FlightTracking, Place} from '#services/flights/schema.ts'
import {
	alertsOf,
	announced,
	expiredActivities,
	holds,
	perDevice,
	showPlan,
	unannouncedDevices
} from '#services/push/lib/utils.ts'
import {Activity, ChannelId, AlertDelivery, SentAlert} from '#services/push/schema.ts'
import type {AlertCategory} from '#services/push/schema.ts'

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
// Everyone booked on the flight cancelled their reservation.
const CANCELLED = [
	{
		boardingGroup: Option.none(),
		confirmation: Option.some('ABC123'),
		name: Option.none(),
		seat: Option.none(),
		status: 'cancelled' as const,
		ticket: Option.none()
	}
]
const STARTER = {
	bundle: 'xyz.mp281x.trips' as const,
	kind: 'start' as const,
	token: Redacted.make(ApnsToken.make(String.repeat(32)('a')))
}
const ACTIVITY = {
	bundle: 'xyz.mp281x.trips' as const,
	channel: ChannelId.make('current'),
	endedAt: Option.none<DateTime.Utc>(),
	flightId: FLIGHT.id,
	leg: 'departure' as const,
	props: activityProps(FLIGHT, DEPARTS, false),
	startedAt: DEPARTS
}

function sentAlert(category: AlertCategory, value: string) {
	return SentAlert.make({category, flightId: FLIGHT.id, sentAt: DEPARTS, value: Option.some(value)})
}

it('retries the other phone without resending an accepted alert, including an older delay step', () => {
	const first = Device.make({...STARTER, kind: 'alert'})
	const second = Device.make({...STARTER, kind: 'alert', token: Redacted.make(ApnsToken.make(String.repeat(32)('b')))})
	const alert = {body: '', category: 'delay' as const, title: '', value: '15'}
	const accepted = AlertDelivery.make({
		category: 'delay',
		flightId: FLIGHT.id,
		sentAt: DEPARTS,
		token: first.token,
		value: Option.some('15')
	})
	assert.deepStrictEqual(unannouncedDevices([first, second], [accepted], alert), [second])
	assert.deepStrictEqual(unannouncedDevices([first], [accepted], alert), [])
	assert.deepStrictEqual(unannouncedDevices([], [], alert), [])
	assert.deepStrictEqual(
		unannouncedDevices(
			[first, second],
			[
				accepted,
				AlertDelivery.make({
					...Struct.pick(accepted, Struct.keys(AlertDelivery.fields)),
					sentAt: DateTime.addDuration(DEPARTS, Duration.minutes(1)),
					value: Option.some('30')
				})
			],
			alert
		),
		[second]
	)
})

it('starts no activity again for a window whose activity ended', () => {
	assert.deepStrictEqual(
		showPlan(
			[Device.make(STARTER)],
			[Activity.make({...ACTIVITY, endedAt: Option.some(DateTime.addDuration(DEPARTS, Duration.minutes(5)))})],
			Flight.make(FLIGHT),
			{end: DateTime.addDuration(DEPARTS, Duration.hours(1)), leg: 'departure', start: DEPARTS}
		),
		[]
	)
})

it('announces a gate change and a fifteen-minute delay once each', () => {
	const alerts = alertsOf(
		Flight.make({
			...FLIGHT,
			live: Option.some(
				Schema.decodeSync(FlightTracking)({
					checkedAt: DateTime.toEpochMillis(DateTime.subtractDuration(DEPARTS, Duration.hours(1))),
					departureEstimated: DateTime.toEpochMillis(DateTime.addDuration(DEPARTS, Duration.minutes(20))),
					departureGate: 'B12',
					previousGate: 'A3',
					state: 'scheduled'
				})
			)
		}),
		DateTime.subtractDuration(DEPARTS, Duration.hours(1))
	)
	assert.deepStrictEqual(
		Array.map(alerts, alert => ({category: alert.category, value: alert.value})),
		[
			{category: 'gate', value: 'B12'},
			{category: 'delay', value: '15'}
		]
	)
	assert.deepStrictEqual(
		Array.map(alerts, alert => announced([sentAlert('gate', 'B12'), sentAlert('delay', '15')], alert)),
		[true, true]
	)
})

it('reannounces a gate returning to an earlier value but remembers every delay step', () => {
	const gate = {body: '', category: 'gate' as const, title: '', value: 'B12'}
	const delay = {body: '', category: 'delay' as const, title: '', value: '15'}
	assert.isFalse(announced([sentAlert('gate', 'B12'), sentAlert('gate', 'A3')], gate))
	assert.isTrue(announced([sentAlert('gate', 'A3'), sentAlert('gate', 'B12')], gate))
	assert.isTrue(announced([sentAlert('delay', '15'), sentAlert('delay', '30')], delay))
	assert.isFalse(announced([sentAlert('delay', '30')], delay))
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
	const cancelled = Flight.make({...FLIGHT, travellers: CANCELLED})
	assert.deepStrictEqual(showPlan([Device.make(STARTER)], [], cancelled, window), [])
	assert.deepStrictEqual(
		Array.map(showPlan([Device.make(STARTER)], [Activity.make(ACTIVITY)], cancelled, window), action => action._tag),
		['refresh']
	)
})

it('ends only running activities whose flight or window is gone', () => {
	const removed = Activity.make({
		...ACTIVITY,
		channel: ChannelId.make('removed'),
		flightId: FlightId.make('aaaaaaaa-0d0a-4a5e-9d8f-5b2a1c3d4e5f')
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

it('tells a cancelled flight only that it is cancelled, never its gate or boarding', () => {
	const now = DateTime.subtractDuration(DEPARTS, Duration.minutes(30))
	const live = {
		checkedAt: DateTime.toEpochMillis(now),
		departureEstimated: DateTime.toEpochMillis(DateTime.addDuration(DEPARTS, Duration.minutes(30))),
		departureGate: 'A3'
	}
	const boarding = {...FLIGHT, boardingAt: Option.some(DateTime.subtractDuration(DEPARTS, Duration.minutes(30)))}
	assert.deepStrictEqual(
		[
			Array.map(
				alertsOf(
					Flight.make({
						...boarding,
						live: Option.some(Schema.decodeSync(FlightTracking)({...live, state: 'cancelled'}))
					}),
					now
				),
				alert => alert.category
			),
			Array.map(
				alertsOf(
					Flight.make({
						...boarding,
						live: Option.some(Schema.decodeSync(FlightTracking)({...live, state: 'scheduled'})),
						travellers: CANCELLED
					}),
					now
				),
				alert => alert.category
			)
		],
		[['cancelled'], ['cancelled']]
	)
})

function gateCheckedAt(checkedAt: DateTime.Utc) {
	return Flight.make({
		...FLIGHT,
		live: Option.some(
			Schema.decodeSync(FlightTracking)({
				checkedAt: DateTime.toEpochMillis(checkedAt),
				departureGate: 'A3',
				state: 'scheduled'
			})
		)
	})
}

it('announces nothing from live data that stopped updating', () => {
	const now = DateTime.subtractDuration(DEPARTS, Duration.minutes(30))
	assert.deepStrictEqual(
		[
			Array.map(alertsOf(gateCheckedAt(now), now), alert => alert.category),
			Array.map(
				alertsOf(gateCheckedAt(DateTime.subtractDuration(now, Duration.hours(1))), now),
				alert => alert.category
			)
		],
		[['gate'], []]
	)
})

it('words a delay by whether the flight has left', () => {
	const departs = DateTime.makeUnsafe('2026-11-18T08:00:00Z')
	const now = DateTime.addDuration(departs, Duration.minutes(25))
	function running(state: FlightTracking['state']) {
		return Flight.make({
			...FLIGHT,
			arrives: DateTime.addDuration(departs, Duration.hours(1)),
			departs,
			live: Option.some(
				Schema.decodeSync(FlightTracking)({
					arrivalEstimated: DateTime.toEpochMillis(DateTime.addDuration(departs, Duration.minutes(90))),
					checkedAt: DateTime.toEpochMillis(now),
					departureEstimated: DateTime.toEpochMillis(DateTime.addDuration(departs, Duration.minutes(30))),
					state
				})
			)
		})
	}
	assert.deepStrictEqual(
		Array.map(['scheduled', 'departed'] as const, state =>
			pipe(
				alertsOf(running(state), now),
				Array.filter(alert => alert.category === 'delay'),
				Array.map(alert => alert.body)
			)
		),
		[['Now departs 09:30'], ['Now lands 09:30']]
	)
})

function delivery(token: Device['token'], value: string, minutes: number) {
	return AlertDelivery.make({
		category: 'gate',
		flightId: FLIGHT.id,
		sentAt: DateTime.addDuration(DEPARTS, Duration.minutes(minutes)),
		token,
		value: Option.some(value)
	})
}

it('reconciles a gate per phone but a delay once per flight', () => {
	assert.deepStrictEqual(
		[
			perDevice({body: '', category: 'gate', title: '', value: 'A'}),
			perDevice({body: '', category: 'delay', title: '', value: '15'}),
			perDevice({body: '', category: 'boarding', title: ''})
		],
		[true, false, false]
	)
	// Both phones had gate A; the gate moved to B, only phone 1 took it, and it went back to A.
	const first = Device.make({...STARTER, kind: 'alert'})
	const second = Device.make({...STARTER, kind: 'alert', token: Redacted.make(ApnsToken.make(String.repeat(32)('b')))})
	assert.deepStrictEqual(
		unannouncedDevices(
			[first, second],
			[delivery(first.token, 'A', 0), delivery(second.token, 'A', 0), delivery(first.token, 'B', 1)],
			{body: '', category: 'gate', title: '', value: 'A'}
		),
		[first]
	)
})
