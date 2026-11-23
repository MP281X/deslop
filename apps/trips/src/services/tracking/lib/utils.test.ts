import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Option, Schema, Struct, pipe} from 'effect'

import {activityProps} from '#services/flights/lib/utils.ts'
import {FlightId, Flight, Place, ProviderFlightId} from '#services/flights/schema.ts'
import {alertsOf} from '#services/push/lib/utils.ts'
import {canRefresh, checkEvery, flightTracking, isDue, isStale, pickFlight} from '#services/tracking/lib/utils.ts'
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
		Array.map(alertsOf(flight, now, {flights: [], travel: []}), alert => alert.category),
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
	const onTime = Option.some({estimated_out: Option.some(departs)})
	const gate = Option.some({estimated_out: Option.some(departs), gate_origin: Option.some('B12')})
	const airborne = Option.some({actual_off: Option.some(departs), estimated_out: Option.some(departs)})
	assert.deepStrictEqual(
		[
			paceAt(Duration.hours(47)),
			paceAt(Duration.hours(46)),
			paceAt(Duration.hours(20)),
			paceAt(Duration.hours(5)),
			paceAt(Duration.hours(2)),
			paceAt(Duration.minutes(80), onTime),
			paceAt(Duration.minutes(40), gate),
			paceAt(Duration.minutes(-10), onTime),
			paceAt(Duration.minutes(-40), onTime),
			paceAt(Duration.minutes(-60), airborne),
			paceAt(Duration.minutes(-130), airborne),
			paceAt(Duration.minutes(-200), airborne),
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
			Option.some(5),
			Option.some(15),
			Option.some(15),
			Option.some(5),
			Option.some(15),
			Option.none()
		]
	)
})

it('takes the faster pace at each cutover itself', () => {
	const departs = DateTime.makeUnsafe('2026-10-28T15:40:00Z')
	const flight = flightAt(departs)
	assert.deepStrictEqual(
		Array.map([Duration.hours(24), Duration.hours(6), Duration.hours(3), Duration.minutes(90)], before =>
			Option.map(checkEvery(flight, DateTime.subtractDuration(departs, before)), Duration.toMinutes)
		),
		[Option.some(180), Option.some(30), Option.some(10), Option.some(2)]
	)
})

// Every 30-second round from before tracking starts until it stops, with a pull to refresh in every round when `pulling`, for a flight FlightAware never reports.
function lookupsOver(flight: Flight, pulling: boolean) {
	const start = DateTime.subtractDuration(flight.departs, Duration.hours(48))
	return pipe(
		Array.makeBy(2 * 60 * (48 + 2 + 3), index => DateTime.addDuration(start, Duration.seconds(30 * index))),
		Array.reduce({attempted: Option.none<DateTime.Utc>(), lookups: 0}, (state, now) => {
			if (!isDue(flight, now, state.attempted) && !(pulling && canRefresh(flight, now, state.attempted))) return state
			return {attempted: Option.some(now), lookups: state.lookups + 1}
		}),
		state => state.lookups
	)
}

it('bounds the lookups of a flight that never reports, pulled to refresh or not', () => {
	const flight = Flight.make({
		...Struct.pick(flightAt(DateTime.makeUnsafe('2026-10-28T15:40:00Z')), Struct.keys(Flight.fields)),
		arrives: DateTime.makeUnsafe('2026-10-28T17:40:00Z')
	})
	// 98 lookups on the schedule, 151 when pulled to refresh in every round.
	assert.deepStrictEqual([lookupsOver(flight, false), lookupsOver(flight, true)], [98, 151])
})

it('lets a pull to refresh ask no sooner than two minutes, or half the pace', () => {
	const departs = DateTime.makeUnsafe('2026-10-28T15:40:00Z')
	const flight = flightAt(departs)
	function after(before: Duration.Duration, since: Duration.Duration) {
		const now = DateTime.subtractDuration(departs, before)
		return canRefresh(flight, now, Option.some(DateTime.subtractDuration(now, since)))
	}
	assert.deepStrictEqual(
		[
			after(Duration.minutes(30), Duration.minutes(1)),
			after(Duration.minutes(30), Duration.minutes(2)),
			after(Duration.hours(20), Duration.minutes(30)),
			after(Duration.hours(20), Duration.minutes(90)),
			canRefresh(flight, DateTime.subtractDuration(departs, Duration.hours(47)), Option.none())
		],
		[false, true, false, true, false]
	)
})

it('waits from the saved report after a restart forgot the last attempt, pulled to refresh or not', () => {
	const departs = DateTime.makeUnsafe('2026-10-28T15:40:00Z')
	const checkedAt = DateTime.subtractDuration(departs, Duration.minutes(70))
	const flight = flightAt(departs, Option.some(flightTracking(ANSWER, checkedAt, Option.none())))
	function after(since: Duration.Duration) {
		const now = DateTime.addDuration(checkedAt, since)
		return [isDue(flight, now, Option.none()), canRefresh(flight, now, Option.none())]
	}
	// The gate is posted, so the pace is five minutes and a pull may ask every two and a half.
	assert.deepStrictEqual(
		[after(Duration.seconds(30)), after(Duration.minutes(2.5)), after(Duration.minutes(5))],
		[
			[false, false],
			[false, true],
			[true, true]
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
