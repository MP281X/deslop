import {assert, it} from '@effect/vitest'

import {DateTime, Option} from 'effect'

import {HOUR, MINUTE} from '#services/bookings/lib/utils.ts'
import {Flight, Train} from '#services/bookings/schema.ts'
import {checkEvery, flightTracking, isStale, trainTracking} from '#services/tracking/lib/utils.ts'
import type {FaFlight} from '#services/tracking/schema.ts'

const ANSWER: FaFlight = {
	cancelled: false,
	diverted: false,
	estimated_out: '2026-10-28T16:00:00Z',
	fa_flight_id: 'BAW553-1761600000-schedule-0001',
	gate_origin: 'B12',
	scheduled_out: '2026-10-28T15:40:00Z',
	terminal_origin: '3'
}

it('keeps the gate a flight left for the change it shows', () => {
	const first = flightTracking({...ANSWER, gate_origin: 'A3'}, 1)
	const changed = flightTracking(ANSWER, 2, first)
	assert.deepStrictEqual(
		[first.previousGate, changed.departureGate, changed.previousGate, flightTracking(ANSWER, 3, changed).previousGate],
		[undefined, 'B12', 'A3', 'A3']
	)
	assert.deepStrictEqual(
		[changed.state, changed.departureEstimated],
		['scheduled', DateTime.toEpochMillis(DateTime.makeUnsafe('2026-10-28T16:00:00Z'))]
	)
	assert.strictEqual(flightTracking({...ANSWER, actual_off: '2026-10-28T16:10:00Z'}, 4).state, 'airborne')
})

it('finds the booked stops by Trenitalia code, else by their printed names', () => {
	const arrived = trainTracking(
		{
			fermate: [
				{
					binarioProgrammatoPartenzaDescrizione: '3',
					id: 'S08409',
					partenzaReale: 1,
					programmata: 0,
					stazione: 'ROMA TERMINI'
				},
				{actualFermataType: 1, binarioEffettivoArrivoDescrizione: '14', id: 'S05046', stazione: 'BOLOGNA C.LE/AV'}
			]
		},
		Train.make({
			arrives: 0,
			createdAt: 0,
			departs: 0,
			from: {code: 'it-trenitalia_08409:station', name: 'Roma', timeZone: 'Europe/Rome'},
			id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
			number: '9541',
			operator: 'trenitalia',
			operatorName: 'Frecciarossa',
			sources: [],
			status: 'confirmed',
			to: {name: 'Bologna Centrale', timeZone: 'Europe/Rome'}
		}),
		1
	)
	assert.deepStrictEqual(
		Option.map(arrived, found => [found.departurePlatform, found.arrivalPlatform, found.state]),
		Option.some(['3', '14', 'arrived'])
	)
})

it('reads the platform, the delay it left with and the delay it runs with at the booked stop', () => {
	const train = Train.make({
		arrives: 0,
		createdAt: 0,
		departs: 0,
		from: {name: 'Roma Termini', timeZone: 'Europe/Rome'},
		id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
		number: '9541',
		operator: 'trenitalia',
		operatorName: 'Frecciarossa',
		sources: [],
		status: 'confirmed',
		to: {name: 'Milano Centrale', timeZone: 'Europe/Rome'}
	})
	const waiting = trainTracking(
		{
			fermate: [
				{
					binarioEffettivoPartenzaDescrizione: ' 12 ',
					binarioProgrammatoPartenzaDescrizione: '9',
					id: 'S08409',
					programmata: 0,
					ritardo: 0,
					stazione: 'ROMA TERMINI'
				},
				{id: 'S01700', stazione: 'MILANO CENTRALE'}
			],
			ritardo: 6,
			stazioneUltimoRilevamento: '--'
		},
		train,
		1
	)
	// Running from an earlier station, the train is still to board here.
	assert.deepStrictEqual(
		Option.map(waiting, found => [
			found.state,
			found.departurePlatform,
			found.departurePlatformPlanned,
			found.delayMinutes,
			found.departureDelay,
			found.lastSeen
		]),
		Option.some(['scheduled', '12', '9', 6, undefined, undefined])
	)
	const left = trainTracking(
		{fermate: [{id: 'S08409', partenzaReale: 1, programmata: 0, ritardo: 3, stazione: 'ROMA TERMINI'}], ritardo: 8},
		train,
		2
	)
	assert.deepStrictEqual(
		Option.map(left, found => [found.state, found.departureDelay ?? 0, found.delayMinutes]),
		Option.some(['departed', 3, 8])
	)
})

it('checks a train each minute near departure and calls live data stale after two missed checks', () => {
	const departs = DateTime.toEpochMillis(DateTime.makeUnsafe('2026-10-28T15:40:00Z'))
	const train = Train.make({
		arrives: departs + 3 * HOUR,
		createdAt: 0,
		departs,
		from: {name: 'Roma Termini', timeZone: 'Europe/Rome'},
		id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
		number: '9541',
		operator: 'trenitalia',
		operatorName: 'Frecciarossa',
		sources: [],
		status: 'confirmed',
		to: {name: 'Milano Centrale', timeZone: 'Europe/Rome'}
	})
	const flight = Flight.make({
		airline: 'British Airways',
		airlineCode: 'BA',
		arrives: departs + 2.5 * HOUR,
		createdAt: 0,
		departs,
		from: {city: 'Rome', code: 'FCO', name: 'Fiumicino', timeZone: 'Europe/Rome'},
		id: '7f0c8f8e-0d0a-4a5e-9d8f-5b2a1c3d4e5f',
		number: '553',
		sources: [],
		status: 'confirmed',
		to: {city: 'London', code: 'LHR', name: 'Heathrow', timeZone: 'Europe/London'}
	})
	const now = departs - 30 * MINUTE
	function live(checkedAt: number) {
		return Train.make({...train, live: {checkedAt, delayMinutes: 0, state: 'scheduled'}})
	}
	assert.deepStrictEqual(
		[checkEvery(train, now), checkEvery(train, departs - 3 * HOUR), checkEvery(flight, departs - 3 * HOUR)],
		[Option.some(MINUTE), Option.some(30 * MINUTE), Option.some(20 * MINUTE)]
	)
	assert.deepStrictEqual([isStale(live(now - 2 * MINUTE), now), isStale(live(now - 5 * MINUTE), now)], [false, true])
	// Tracking stops after arrival, and data it never replaced stays stale; an arrival is final.
	assert.deepStrictEqual(
		[
			isStale(live(now), train.arrives + HOUR),
			isStale(Train.make({...train, live: {checkedAt: now, delayMinutes: 0, state: 'arrived'}}), train.arrives + HOUR)
		],
		[true, false]
	)
	// A timetable-only train is never checked, so its last answer is not stale.
	assert.deepStrictEqual(
		[
			checkEvery(Train.make({...train, operator: 'other'}), now),
			isStale(Train.make({...live(0), operator: 'other'}), now)
		],
		[Option.none(), false]
	)
})

it("answers nothing for another day's run of the number or a run that does not call at the booked station", () => {
	const train = Train.make({
		arrives: 0,
		createdAt: 0,
		departs: 0,
		from: {name: 'Roma Termini', timeZone: 'Europe/Rome'},
		id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
		number: '9541',
		operator: 'trenitalia',
		operatorName: 'Frecciarossa',
		sources: [],
		status: 'confirmed',
		to: {name: 'Milano Centrale', timeZone: 'Europe/Rome'}
	})
	assert.deepStrictEqual(
		[
			trainTracking({fermate: [{id: 'S08409', programmata: 5 * HOUR, stazione: 'ROMA TERMINI'}], ritardo: 0}, train, 1),
			trainTracking({fermate: [{id: 'S08409', partenzaReale: 1, stazione: 'ROMA TERMINI'}], ritardo: 0}, train, 1),
			trainTracking({fermate: [], ritardo: 9}, train, 1)
		],
		[Option.none(), Option.none(), Option.none()]
	)
})
