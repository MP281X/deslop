import {assert, it} from '@effect/vitest'

import {Array, DateTime, Option, Schema, Struct} from 'effect'

import {boardChangeOf, boardOf, datesOf, nextHero, openedFlight} from '#lib/day.ts'
import type {Change} from '#lib/day.ts'
import {FlightId, Flight, Place, PlaceCode, TravelTime} from '#services/flights/schema.ts'

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
		return Array.map(datesOf([overnight, onward], now, Option.none()), date => [
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

// Whether each row of the day at 10:00 follows a change row.
function feeders(shown: Option.Option<Change>) {
	return Array.flatMap(datesOf(DAY, at('10:00'), shown), date => Array.map(date.rows, row => Option.isSome(row.feeder)))
}

it("leaves out the change a laptop's board shows above the list", () => {
	const change = boardChangeOf(DAY, at('10:00'))
	assert.deepStrictEqual(
		Option.map(change, found => [found.feeder.number, found.next.number]),
		Option.some(['1234', '206'])
	)
	assert.deepStrictEqual(
		[feeders(Option.none()), feeders(change)],
		[
			[false, true],
			[false, false]
		]
	)
	// Once the day is at its last flight there is no change left to show.
	assert.isTrue(Option.isNone(boardChangeOf(DAY, at('11:05'))))
})
