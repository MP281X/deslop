import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Option, Redacted, Schema, String, Struct, pipe} from 'effect'

import {ApnsToken, Device} from '@deslop/runtime/shared/apns'

import {activityProps, MINUTE} from '#services/flights/lib/utils.ts'
import {FlightId, Flight, FlightTracking, Place, PlaceCode, TravelTime} from '#services/flights/schema.ts'
import {
	alertsOf,
	announced,
	expiredActivities,
	feederOf,
	holds,
	perDevice,
	ridingAlerts,
	showPlan,
	unannouncedDevices
} from '#services/push/lib/utils.ts'
import type {Alert, AlertContext} from '#services/push/lib/utils.ts'
import {Activity, ChannelId, AlertDelivery, SentAlert} from '#services/push/schema.ts'
import type {AlertCategory} from '#services/push/schema.ts'

const NO_CONTEXT: AlertContext = {flights: [], travel: []}

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
		DateTime.subtractDuration(DEPARTS, Duration.hours(1)),
		NO_CONTEXT
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
					now,
					NO_CONTEXT
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
					now,
					NO_CONTEXT
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
			Array.map(alertsOf(gateCheckedAt(now), now, NO_CONTEXT), alert => alert.category),
			Array.map(
				alertsOf(gateCheckedAt(DateTime.subtractDuration(now, Duration.hours(1))), now, NO_CONTEXT),
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
				alertsOf(running(state), now, NO_CONTEXT),
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

// FR 1234 from Bergamo at 10:30 on 24 November (09:30 UTC), with Matteo and Anna on it, and the trip to Bergamo saved as two hours.
const RYANAIR = Struct.pick(
	Flight.make({
		airline: 'Ryanair',
		airlineCode: 'FR',
		arrives: DateTime.makeUnsafe('2026-11-24T11:35:00Z'),
		boardingAt: Option.none(),
		departs: DateTime.makeUnsafe('2026-11-24T09:30:00Z'),
		from: Schema.decodeSync(Place)({city: 'Bergamo', code: 'BGY', name: 'Milan Bergamo', timeZone: 'Europe/Rome'}),
		id: FlightId.make('3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f'),
		live: Option.none(),
		number: '1234',
		to: Schema.decodeSync(Place)({city: 'London', code: 'STN', name: 'Stansted', timeZone: 'Europe/London'}),
		travellers: [
			{
				boardingGroup: Option.none(),
				confirmation: Option.some('ABC123'),
				name: Option.some('Matteo Rossi'),
				seat: Option.some('14C'),
				status: 'confirmed',
				ticket: Option.none()
			},
			{
				boardingGroup: Option.none(),
				confirmation: Option.some('ABC123'),
				name: Option.some('Anna Bianchi'),
				seat: Option.none(),
				status: 'confirmed',
				ticket: Option.none()
			}
		]
	}),
	Struct.keys(Flight.fields)
)
const TO_BERGAMO: AlertContext = {
	flights: [],
	travel: [TravelTime.make({airport: PlaceCode.make('BGY'), minutes: 120})]
}

function alertAt(flight: Flight, now: DateTime.Utc, context: AlertContext, category: AlertCategory) {
	return Array.findFirst(alertsOf(flight, now, context), alert => alert.category === category)
}

// Whether the alert of a category is due that long before the booked departure.
function dueAt(flight: Flight, before: Duration.Duration, category: AlertCategory, context = NO_CONTEXT) {
	return Option.isSome(alertAt(flight, DateTime.subtractDuration(flight.departs, before), context, category))
}

function liveFor(flight: typeof RYANAIR, live: Partial<typeof FlightTracking.Encoded>) {
	return Flight.make({
		...flight,
		live: Option.some(
			Schema.decodeSync(FlightTracking)({
				checkedAt: DateTime.toEpochMillis(DateTime.subtractDuration(flight.departs, Duration.hours(2))),
				state: 'scheduled',
				...live
			})
		)
	})
}

function delayAfter(minutes: number, inbound: Option.Option<number> = Option.none()) {
	return Option.map(
		alertAt(
			liveFor(RYANAIR, {
				departureEstimated: DateTime.toEpochMillis(DateTime.addDuration(RYANAIR.departs, Duration.minutes(minutes))),
				...Option.match(inbound, {onNone: () => ({}), onSome: inboundDelay => ({inboundDelay})})
			}),
			DateTime.subtractDuration(RYANAIR.departs, Duration.hours(2)),
			NO_CONTEXT,
			'delay'
		),
		alert => [alert.value, alert.title, alert.body]
	)
}

it('opens check-in 72 h out on Ryanair and 24 h out elsewhere, and reminds 12 h before it closes while someone has no pass', () => {
	const ryanair = Flight.make(RYANAIR)
	const other = Flight.make({...RYANAIR, airlineCode: 'BA'})
	assert.deepStrictEqual(
		Array.map(
			[
				[ryanair, 73],
				[ryanair, 71],
				[ryanair, 13],
				[other, 25],
				[other, 23],
				[other, 12],
				[other, 0.5]
			] as const,
			pair => [dueAt(pair[0], Duration.hours(pair[1]), 'checkin'), dueAt(pair[0], Duration.hours(pair[1]), 'closing')]
		),
		[
			[false, false],
			[true, false],
			[false, true],
			[false, false],
			[true, false],
			[false, true],
			[false, false]
		]
	)
	// A pass gave the flight its boarding time; Anna still has no seat, so she has no pass, until hers comes.
	const boarding = {...RYANAIR, boardingAt: Option.some(DateTime.makeUnsafe('2026-11-24T08:50:00Z'))}
	assert.deepStrictEqual(
		[
			Option.map(
				alertAt(Flight.make(boarding), DateTime.makeUnsafe('2026-11-23T20:00:00Z'), NO_CONTEXT, 'closing'),
				alert => alert.body
			),
			dueAt(
				Flight.make({
					...boarding,
					travellers: Array.map(boarding.travellers, traveller => ({...traveller, seat: Option.some('14D')}))
				}),
				Duration.hours(13),
				'closing'
			)
		],
		[Option.some('Check-in closes tomorrow at 08:30 · No boarding pass yet for Anna Bianchi'), false]
	)
})

// The plan of a flight from Bergamo, two hours from home, so he leaves three hours before it departs: whether it is due at a time, and a minute before.
function planFrom(leave: string, at: string) {
	const flight = Flight.make({...RYANAIR, departs: DateTime.addDuration(DateTime.makeUnsafe(leave), Duration.hours(3))})
	return Array.map([DateTime.subtractDuration(DateTime.makeUnsafe(at), MINUTE), DateTime.makeUnsafe(at)], now =>
		Option.isSome(alertAt(flight, now, TO_BERGAMO, 'plan'))
	)
}

it('plans the day twelve hours before leaving, moved earlier into 09:00–21:00 and never later', () => {
	assert.deepStrictEqual(
		[
			// Leaving at 07:30 is told at 19:30 the day before.
			planFrom('2026-11-24T06:30:00Z', '2026-11-23T18:30:00Z'),
			// A 01:00 flight, leaving home at 22:00, is told at 10:00 that day.
			planFrom('2026-11-24T21:00:00Z', '2026-11-24T09:00:00Z'),
			// Leaving at 18:00 would be told at 06:00, so it comes at 21:00 the evening before.
			planFrom('2026-11-24T17:00:00Z', '2026-11-23T20:00:00Z'),
			// Leaving at 10:00 would be told at 22:00, so it comes at 21:00 that evening.
			planFrom('2026-11-24T09:00:00Z', '2026-11-23T20:00:00Z')
		],
		Array.makeBy(4, () => [false, true])
	)
	assert.deepStrictEqual(
		[
			Option.map(
				alertAt(Flight.make(RYANAIR), DateTime.makeUnsafe('2026-11-23T18:30:00Z'), TO_BERGAMO, 'plan'),
				alert => [alert.title, alert.body]
			),
			dueAt(Flight.make(RYANAIR), Duration.hours(16), 'plan', TO_BERGAMO)
		],
		[Option.some(['FR 1234 · Bergamo → London', 'Tomorrow: leave by 07:30 for Bergamo, airport by 09:30']), false]
	)
})

it('says leave now fifteen minutes before the leave time, with directions to the airport', () => {
	const flight = Flight.make(RYANAIR)
	assert.deepStrictEqual(
		[
			Option.map(alertAt(flight, DateTime.makeUnsafe('2026-11-24T06:15:00Z'), TO_BERGAMO, 'leave'), alert => [
				alert.title,
				alert.body,
				alert.directions
			]),
			dueAt(flight, Duration.minutes(196), 'leave', TO_BERGAMO),
			dueAt(flight, Duration.minutes(194), 'leave', TO_BERGAMO),
			dueAt(flight, Duration.minutes(194), 'leave')
		],
		[
			Option.some(['Leave now for Bergamo', 'Leave by 07:30, airport by 09:30 · FR 1234 departs 10:30', flight.from]),
			false,
			true,
			false
		]
	)
})

it('tells a delay in fifteen-minute steps of whole minutes, with the inbound plane as its cause', () => {
	assert.deepStrictEqual(
		[
			delayAfter(14),
			delayAfter(14.5),
			delayAfter(15),
			delayAfter(29),
			delayAfter(29 + 59 / 60),
			delayAfter(30),
			delayAfter(50, Option.some(50))
		],
		[
			Option.none(),
			Option.none(),
			Option.some(['15', 'FR 1234 is 15 min late', 'Now departs 10:45']),
			Option.some(['15', 'FR 1234 is 29 min late', 'Now departs 10:59']),
			Option.some(['15', 'FR 1234 is 29 min late', 'Now departs 10:59']),
			Option.some(['30', 'FR 1234 is 30 min late', 'Now departs 11:00']),
			Option.some(['45', 'FR 1234 is 50 min late', 'Now departs 11:20 · inbound plane 50 min late'])
		]
	)
})

it('warns of a connection under an hour or shrinking by fifteen minutes', () => {
	// FR 206 leaves Stansted at 13:00, 85 minutes after FR 1234 is booked to land.
	const onward = Flight.make({
		...RYANAIR,
		arrives: DateTime.makeUnsafe('2026-11-24T14:20:00Z'),
		departs: DateTime.makeUnsafe('2026-11-24T13:00:00Z'),
		from: RYANAIR.to,
		id: FlightId.make('4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a'),
		number: '206',
		to: Schema.decodeSync(Place)({city: 'Dublin', code: 'DUB', name: 'Dublin', timeZone: 'Europe/Dublin'})
	})
	assert.deepStrictEqual(
		Array.map(['2026-11-24T11:35:00Z', '2026-11-24T11:55:00Z', '2026-11-24T12:25:00Z'], lands =>
			Option.map(
				alertAt(
					onward,
					DateTime.makeUnsafe('2026-11-24T10:00:00Z'),
					{
						flights: [liveFor(RYANAIR, {arrivalEstimated: DateTime.toEpochMillis(DateTime.makeUnsafe(lands))}), onward],
						travel: []
					},
					'connection'
				),
				alert => [alert.value, alert.title, alert.body]
			)
		),
		[
			Option.none(),
			Option.some(['60', '65 min to change for FR 206', 'FR 1234 lands 11:55 · FR 206 departs 13:00']),
			Option.some(['30', '35 min to change for FR 206', 'FR 1234 lands 12:25 · FR 206 departs 13:00'])
		]
	)
})

it('treats a flight he connects to as no trip from home, and a diverted flight as no time to change', () => {
	// FR 1234 lands at Stansted at 11:35; FR 206 leaves Stansted at 13:00, and Stansted is an hour from home.
	const onward = Flight.make({
		...RYANAIR,
		arrives: DateTime.makeUnsafe('2026-11-24T14:20:00Z'),
		boardingAt: Option.some(DateTime.makeUnsafe('2026-11-24T12:30:00Z')),
		departs: DateTime.makeUnsafe('2026-11-24T13:00:00Z'),
		from: RYANAIR.to,
		id: FlightId.make('4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f7a'),
		number: '206',
		to: Schema.decodeSync(Place)({city: 'Dublin', code: 'DUB', name: 'Dublin', timeZone: 'Europe/Dublin'}),
		travellers: Array.map(RYANAIR.travellers, traveller => ({...traveller, seat: Option.some('14C')}))
	})
	const toStansted = [TravelTime.make({airport: PlaceCode.make('STN'), minutes: 60})]
	const airborne = liveFor(RYANAIR, {
		arrivalEstimated: DateTime.toEpochMillis(DateTime.makeUnsafe('2026-11-24T12:25:00Z')),
		state: 'airborne'
	})
	const diverted = liveFor(RYANAIR, {
		arrivalEstimated: DateTime.toEpochMillis(DateTime.makeUnsafe('2026-11-24T12:40:00Z')),
		state: 'diverted'
	})
	function categories(feeder: Flight, at: string) {
		return Array.map(
			alertsOf(onward, DateTime.makeUnsafe(at), {flights: [feeder, onward], travel: toStansted}),
			alert => alert.category
		)
	}
	assert.deepStrictEqual(
		[
			feederOf(onward, [airborne, onward]),
			categories(airborne, '2026-11-23T21:00:00Z'),
			categories(airborne, '2026-11-24T11:05:00Z'),
			categories(diverted, '2026-11-24T11:05:00Z'),
			categories(
				Flight.make({
					...RYANAIR,
					travellers: Array.map(RYANAIR.travellers, traveller => ({...traveller, status: 'cancelled' as const}))
				}),
				'2026-11-24T11:05:00Z'
			)
		],
		[Option.some(airborne), ['connection'], ['connection'], [], ['leave']]
	)
})

it('calls boarding ten minutes before the pass says, moved by the delay, and again when the delay crosses a step', () => {
	const late = liveFor(
		{...RYANAIR, boardingAt: Option.some(DateTime.subtractDuration(RYANAIR.departs, Duration.minutes(30)))},
		{
			checkedAt: DateTime.toEpochMillis(DateTime.subtractDuration(RYANAIR.departs, Duration.minutes(36))),
			departureEstimated: DateTime.toEpochMillis(DateTime.addDuration(RYANAIR.departs, Duration.minutes(20)))
		}
	)
	assert.deepStrictEqual(
		[dueAt(late, Duration.minutes(35), 'boarding'), dueAt(late, Duration.minutes(20), 'boarding')],
		[false, true]
	)
})

it("lets a running activity tell its flight's changes, not the plan, to the phones of its app", () => {
	const phone = Device.make({...STARTER, kind: 'alert'})
	const gate: Alert = {body: '', category: 'gate', title: '', value: 'A6'}
	const plan: Alert = {body: '', category: 'plan', title: ''}
	const told = AlertDelivery.make({
		category: 'gate',
		flightId: FLIGHT.id,
		sentAt: DEPARTS,
		token: phone.token,
		value: Option.some('A6')
	})
	assert.deepStrictEqual(
		[
			ridingAlerts([gate, plan], [], [], [phone], 'xyz.mp281x.trips'),
			ridingAlerts([gate, plan], [], [], [phone], 'xyz.mp281x.trips.dev'),
			ridingAlerts([gate], [], [told], [phone], 'xyz.mp281x.trips')
		],
		[[gate], [], []]
	)
})
