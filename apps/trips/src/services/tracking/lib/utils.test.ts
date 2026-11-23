import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Option, Schema, Struct} from 'effect'

import {activityProps} from '#services/flights/lib/utils.ts'
import {FlightId, Flight, Place, ProviderFlightId} from '#services/flights/schema.ts'
import {alertsOf} from '#services/push/lib/utils.ts'
import {checkEvery, flightTracking, isStale, pickFlight} from '#services/tracking/lib/utils.ts'
import {FaFlight} from '#services/tracking/schema.ts'

const ANSWER = Schema.decodeSync(FaFlight)({
	cancelled: false,
	diverted: false,
	estimated_out: '2026-10-28T16:00:00Z',
	fa_flight_id: 'BAW553-1761600000-schedule-0001',
	gate_origin: 'B12',
	scheduled_out: '2026-10-28T15:40:00Z',
	terminal_origin: '3'
})
function flightAt(departs: DateTime.Utc, live: Flight['live'] = Option.none()) {
	return Flight.make({
		airline: 'British Airways',
		airlineCode: 'BA',
		arrives: DateTime.addDuration(departs, Duration.hours(2.5)),
		boardingAt: Option.none(),
		departs,
		from: Schema.decodeSync(Place)({city: 'Rome', code: 'FCO', name: 'Fiumicino', timeZone: 'Europe/Rome'}),
		id: FlightId.make('7f0c8f8e-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
		live,
		number: '553',
		to: Schema.decodeSync(Place)({city: 'London', code: 'LHR', name: 'Heathrow', timeZone: 'Europe/London'}),
		travellers: []
	})
}

it('carries a provider cancellation into the island and one cancellation alert', () => {
	const now = DateTime.makeUnsafe(0)
	const flight = flightAt(
		DateTime.addDuration(now, Duration.hours(3)),
		Option.some(flightTracking({...ANSWER, cancelled: true}, now, Option.none()))
	)
	assert.deepStrictEqual(checkEvery(flight, now), Option.none())
	assert.deepStrictEqual(
		Array.map(alertsOf(flight, now), alert => alert.category),
		['cancelled']
	)
	assert.strictEqual(activityProps(flight, now, false).tone, 'bad')
})

it('keeps the gate a flight left for the change it shows', () => {
	const first = flightTracking({...ANSWER, gate_origin: Option.some('A3')}, DateTime.makeUnsafe(1), Option.none())
	const changed = flightTracking(ANSWER, DateTime.makeUnsafe(2), Option.some(first))
	assert.deepStrictEqual(
		[
			first.previousGate,
			changed.departureGate,
			changed.previousGate,
			flightTracking(ANSWER, DateTime.makeUnsafe(3), Option.some(changed)).previousGate
		],
		[Option.none(), Option.some('B12'), Option.some('A3'), Option.some('A3')]
	)
	assert.deepStrictEqual(
		[changed.state, changed.departureEstimated],
		['scheduled', Option.some(DateTime.makeUnsafe('2026-10-28T16:00:00Z'))]
	)
	assert.strictEqual(
		flightTracking(
			{...ANSWER, actual_off: Option.some(DateTime.makeUnsafe('2026-10-28T16:10:00Z'))},
			DateTime.makeUnsafe(4),
			Option.none()
		).state,
		'airborne'
	)
})

it('checks a flight on a pace that quickens toward departure and stops at landing', () => {
	const departs = DateTime.makeUnsafe('2026-10-28T15:40:00Z')
	function paceAt(before: Duration.Duration, live: Option.Option<Partial<FaFlight>> = Option.none()) {
		const now = DateTime.subtractDuration(departs, before)
		const flight = flightAt(
			departs,
			Option.map(live, answer => flightTracking({...ANSWER, gate_origin: Option.none(), ...answer}, now, Option.none()))
		)
		return Option.map(checkEvery(flight, now), Duration.toMinutes)
	}
	const gate = Option.some({gate_origin: Option.some('B12')})
	const airborne = Option.some({actual_off: Option.some(departs), estimated_out: Option.some(departs)})
	assert.deepStrictEqual(
		[
			paceAt(Duration.hours(49)),
			paceAt(Duration.hours(47)),
			paceAt(Duration.hours(20)),
			paceAt(Duration.hours(5)),
			paceAt(Duration.hours(2)),
			paceAt(Duration.minutes(80), Option.some({estimated_out: Option.some(departs)})),
			paceAt(
				Duration.minutes(40),
				Option.map(gate, found => ({...found, estimated_out: Option.some(departs)}))
			),
			paceAt(Duration.minutes(-60), airborne),
			paceAt(Duration.minutes(-130), airborne),
			paceAt(Duration.minutes(-150), Option.some({actual_on: Option.some(departs)}))
		],
		[
			Option.none(),
			Option.some(360),
			Option.some(180),
			Option.some(30),
			Option.some(10),
			Option.some(2),
			Option.some(5),
			Option.some(15),
			Option.some(5),
			Option.none()
		]
	)
})

it('calls live data stale after two missed checks, but never an arrival', () => {
	const departs = DateTime.makeUnsafe('2026-10-28T15:40:00Z')
	const now = DateTime.subtractDuration(departs, Duration.minutes(30))
	function live(checkedAt: DateTime.Utc, answer: FaFlight = ANSWER) {
		return flightAt(departs, Option.some(flightTracking(answer, checkedAt, Option.none())))
	}
	assert.deepStrictEqual(
		[
			isStale(live(DateTime.subtractDuration(now, Duration.minutes(2))), now),
			isStale(live(DateTime.subtractDuration(now, Duration.minutes(15))), now)
		],
		[false, true]
	)
	const later = DateTime.addDuration(departs, Duration.hours(3))
	assert.deepStrictEqual(
		[isStale(live(now), later), isStale(live(now, {...ANSWER, actual_in: Option.some(now)}), later)],
		[true, false]
	)
})

it('keeps the flight it identified before while it is still near the booked time', () => {
	const booked = Flight.make({
		airline: 'British Airways',
		airlineCode: 'BA',
		arrives: DateTime.makeUnsafe('2026-10-28T18:10:00Z'),
		boardingAt: Option.none(),
		departs: DateTime.makeUnsafe('2026-10-28T15:40:00Z'),
		from: Schema.decodeSync(Place)({code: 'FCO', name: 'Fiumicino', timeZone: 'Europe/Rome'}),
		id: FlightId.make('7f0c8f8e-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
		live: Option.some(
			flightTracking(
				{...ANSWER, fa_flight_id: ProviderFlightId.make('previous')},
				DateTime.makeUnsafe(1),
				Option.none()
			)
		),
		number: '553',
		to: Schema.decodeSync(Place)({code: 'LHR', name: 'Heathrow', timeZone: 'Europe/London'}),
		travellers: []
	})
	const origin = Option.some({code_iata: Option.some('FCO')})
	const flights = [
		{...ANSWER, fa_flight_id: ProviderFlightId.make('other'), origin, scheduled_out: Option.some(booked.departs)},
		{
			...ANSWER,
			fa_flight_id: ProviderFlightId.make('previous'),
			origin,
			scheduled_out: Option.some(DateTime.addDuration(booked.departs, Duration.minutes(50)))
		}
	]
	assert.deepStrictEqual(
		Option.map(pickFlight(flights, booked), found => found.fa_flight_id),
		Option.some(ProviderFlightId.make('previous'))
	)
	assert.deepStrictEqual(
		Option.map(
			pickFlight(flights, Flight.make({...Struct.pick(booked, Struct.keys(Flight.fields)), live: Option.none()})),
			found => found.fa_flight_id
		),
		Option.some(ProviderFlightId.make('other'))
	)
})
