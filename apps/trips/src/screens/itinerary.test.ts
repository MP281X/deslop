import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Function, Option, Schema, Struct, pipe} from 'effect'

import {FlightId, Flight, Place, PlaceCode, TravelTime} from '#contracts'
import type {FlightTracking} from '#contracts'

import {boardOf, datesOf, nextBoardOf, nextHero, openedFlight, tripOf} from '#screens/itinerary.ts'

const BERGAMO = Schema.decodeSync(Place)({city: 'Bergamo', code: 'BGY', name: 'Milan Bergamo', timeZone: 'Europe/Rome'})
const STANSTED = Schema.decodeSync(Place)({
	city: 'London',
	code: 'STN',
	name: 'London Stansted',
	timeZone: 'Europe/London'
})
const DUBLIN = Schema.decodeSync(Place)({city: 'Dublin', code: 'DUB', name: 'Dublin', timeZone: 'Europe/Dublin'})
const NEWARK = Schema.decodeSync(Place)({city: 'New York', code: 'EWR', name: 'Newark', timeZone: 'America/New_York'})

function at(time: string) {
	return DateTime.makeUnsafe(`2026-11-23T${time}:00Z`)
}

function flight(id: string, number: string, from: Place, to: Place, departs: DateTime.Utc, arrives: DateTime.Utc) {
	return Struct.pick(
		Flight.make({
			airline: 'Ryanair',
			airlineCode: 'FR',
			arrives,
			boardingAt: Option.none(),
			confirmation: Option.none(),
			departs,
			from,
			id: FlightId.make(`${id}-0d0a-4a5e-9d8f-5b2a1c3d4e5f`),
			live: Option.none(),
			number,
			status: 'confirmed',
			to,
			travellers: []
		}),
		Struct.keys(Flight.fields)
	)
}

// FR 1234 Bergamo → Stansted 09:00–11:00, then FR 206 Stansted → Dublin 18:00–20:00.
const FIRST = flight('11111111', '1234', BERGAMO, STANSTED, at('09:00'), at('11:00'))
const SECOND = flight('22222222', '206', STANSTED, DUBLIN, at('18:00'), at('20:00'))
const DAY = [FIRST, SECOND]

it("opens the Live Activity's day link at the flight the day is at, while a flight's own link stays on it", () => {
	assert.deepStrictEqual(
		[
			openedFlight(DAY, {day: true, id: FIRST.id}, at('10:00')),
			openedFlight(DAY, {day: true, id: FIRST.id}, at('11:05')),
			openedFlight(DAY, {day: false, id: FIRST.id}, at('11:05'))
		],
		[FIRST.id, SECOND.id, FIRST.id]
	)
	// The board moves to the connection at landing, not an hour after it.
	assert.deepStrictEqual(
		Array.map([at('10:00'), at('11:05')], now => Option.map(boardOf(DAY, now), found => found.number)),
		[Option.some('1234'), Option.some('206')]
	)
})

it('never asks a connecting traveller to leave for the airport he landed at', () => {
	const travel = [TravelTime.make({airport: PlaceCode.make('STN'), minutes: 60})]
	assert.deepStrictEqual(
		Option.map(nextHero(DAY, at('12:01'), travel), hero => [hero.label, hero.value]),
		Option.some(['Gate for FR 206', 'Not yet'])
	)
})

it('keeps the change row of a connection across a date, from the whole day', () => {
	const overnight = flight('33333333', '1', NEWARK, STANSTED, DateTime.makeUnsafe('2026-11-22T23:00:00Z'), at('06:00'))
	const onward = flight('44444444', '2', STANSTED, DUBLIN, at('07:30'), at('08:59'))
	function rows(now: DateTime.Utc) {
		return Array.map(datesOf([overnight, onward], now, []), date => [
			date.date,
			Array.map(date.rows, row => Option.map(row.feeder, feeder => feeder.number))
		])
	}
	assert.deepStrictEqual(rows(at('05:00')), [
		['Sunday 22 November', [Option.none()]],
		['Monday 23 November', [Option.some('1')]]
	])
	// An hour after landing the flight in leaves the list; the change to the next one stays.
	assert.deepStrictEqual(rows(at('07:01')), [['Monday 23 November', [Option.some('1')]]])
})

function tracking(fields: Partial<FlightTracking>) {
	return Option.some<FlightTracking>({
		aircraft: Option.none(),
		arrivalActual: Option.none(),
		arrivalEstimated: Option.none(),
		checkedAt: at('09:00'),
		departureActual: Option.none(),
		departureEstimated: Option.none(),
		departureGate: Option.none(),
		departureTerminal: Option.none(),
		inboundDelay: Option.none(),
		previousGate: Option.none(),
		providerId: Option.none(),
		state: 'scheduled',
		takeoffActual: Option.none(),
		...fields
	})
}

const PASSENGER = {
	boardingGroup: Option.some('3'),
	boardingPass: true,
	confirmation: Option.none<string>(),
	name: Option.none<string>(),
	seat: Option.some('14C'),
	status: 'confirmed' as const,
	ticket: Option.none<string>()
}

// The day with what the gates, seats and aircraft say, and the second flight's plane flying in late.
const FIRST_AT_GATE = {
	...FIRST,
	boardingAt: Option.some(at('08:30')),
	live: tracking({
		aircraft: Option.some('A320neo'),
		departureGate: Option.some('E38'),
		departureTerminal: Option.some('3')
	}),
	travellers: [PASSENGER]
}
const SECOND_LATE = {
	...SECOND,
	live: tracking({departureTerminal: Option.some('5'), inboundDelay: Option.some(Duration.minutes(20))})
}
const TRIP = [FIRST_AT_GATE, SECOND_LATE]

it('lists the trip as its steps, each with the muted line as stored and its time at the trailing edge', () => {
	assert.deepStrictEqual(
		Array.flatMap(tripOf(TRIP, at('08:00')).dates, date =>
			Array.map(date.steps, step => [
				step.title,
				pipe(
					step.problem,
					Option.map(problem => problem.reason),
					Option.orElse(() => step.line),
					Option.getOrElse(Function.constant(''))
				),
				step.time,
				Option.map(step.problem, problem => problem.status)
			])
		),
		[
			['FR 1234 boards', 'Terminal 3 · gate E38 · seat 14C · group 3', '09:30', Option.none()],
			['FR 1234 departs Bergamo', 'A320neo', '10:00', Option.none()],
			['Lands in London', 'Terminal 5 · 7h 00m to change', '11:00', Option.none()],
			['FR 206 boards', 'Terminal 5', '17:30', Option.none()],
			['FR 206 departs London', 'Plane flying in 20 min late', '18:00', Option.some('warning')],
			['Lands in Dublin', '', '20:00', Option.none()]
		]
	)
})

it("leaves a flight's steps once it landed an hour ago, and the flights of the trip out of the later dates", () => {
	const trip = tripOf(TRIP, at('12:30'))
	assert.deepStrictEqual(
		Array.flatMap(trip.dates, date => Array.map(date.steps, step => step.flight.number)),
		['206', '206', '206']
	)
	assert.deepStrictEqual(
		Array.map(datesOf(TRIP, at('12:30'), trip.flights), date => date.rows.length),
		[]
	)
})

it('leads a laptop with the next step of a trip with a change to come, the gate beside its time', () => {
	assert.deepStrictEqual(
		Option.map(nextBoardOf(TRIP, at('08:00')), found => [
			found.hero.label,
			found.hero.value,
			found.hero.right,
			Option.getOrElse(found.line, Function.constant(''))
		]),
		Option.some(['FR 1234 boards', 'E38 · 09:30', 'in 30 min', 'Terminal 3 · seat 14C · group 3'])
	)
	// Once the day is at its last flight there is no change left, so its board stays as the flight's.
	assert.isTrue(Option.isNone(nextBoardOf(TRIP, at('11:05'))))
})
