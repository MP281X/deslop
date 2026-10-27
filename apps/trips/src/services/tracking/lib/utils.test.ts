import {assert, it} from '@effect/vitest'

import {DateTime, Option} from 'effect'

import {HOUR} from '#services/bookings/lib/utils.ts'
import {Train} from '#services/bookings/schema.ts'
import {flightTracking, trainTracking} from '#services/tracking/lib/utils.ts'
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
			from: {code: 'it-trenitalia_08409:station', name: 'Roma'},
			id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
			number: '9541',
			operator: 'trenitalia',
			operatorName: 'Frecciarossa',
			sources: [],
			status: 'confirmed',
			to: {name: 'Bologna Centrale'}
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
		from: {name: 'Roma Termini'},
		id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
		number: '9541',
		operator: 'trenitalia',
		operatorName: 'Frecciarossa',
		sources: [],
		status: 'confirmed',
		to: {name: 'Milano Centrale'}
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

it("answers nothing for another day's run of the number or a run that does not call at the booked station", () => {
	const train = Train.make({
		arrives: 0,
		createdAt: 0,
		departs: 0,
		from: {name: 'Roma Termini'},
		id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
		number: '9541',
		operator: 'trenitalia',
		operatorName: 'Frecciarossa',
		sources: [],
		status: 'confirmed',
		to: {name: 'Milano Centrale'}
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
