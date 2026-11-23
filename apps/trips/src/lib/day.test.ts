import {assert, it} from '@effect/vitest'

import {Array, DateTime, Option, Schema, Struct} from 'effect'

import {boardOf, openedFlight} from '#lib/day.ts'
import {FlightId, Flight, Place} from '#services/flights/schema.ts'

const BERGAMO = Schema.decodeSync(Place)({city: 'Bergamo', code: 'BGY', name: 'Milan Bergamo', timeZone: 'Europe/Rome'})
const STANSTED = Schema.decodeSync(Place)({
	city: 'London',
	code: 'STN',
	name: 'London Stansted',
	timeZone: 'Europe/London'
})
const DUBLIN = Schema.decodeSync(Place)({city: 'Dublin', code: 'DUB', name: 'Dublin', timeZone: 'Europe/Dublin'})

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
