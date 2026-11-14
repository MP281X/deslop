import {assert, it} from '@effect/vitest'

import {DateTime, Duration, Option, Schema, Struct} from 'effect'

import {BookedPlace, BookingId, Flight, Train, TrainTracking} from '#services/bookings/schema.ts'
import {checkEvery, flightTracking, isStale, trainTracking} from '#services/tracking/lib/utils.ts'
import {FaFlight, VtStatus} from '#services/tracking/schema.ts'

const ANSWER = Schema.decodeSync(FaFlight)({
	cancelled: false,
	diverted: false,
	estimated_out: '2026-10-28T16:00:00Z',
	fa_flight_id: 'BAW553-1761600000-schedule-0001',
	gate_origin: 'B12',
	scheduled_out: '2026-10-28T15:40:00Z',
	terminal_origin: '3'
})
const train = Struct.pick(
	Train.make({
		arrives: DateTime.makeUnsafe(0),
		coach: Option.none(),
		confirmation: Option.none(),
		departs: DateTime.makeUnsafe(0),
		from: Schema.decodeSync(BookedPlace)({name: 'Roma Termini', timeZone: 'Europe/Rome'}),
		id: BookingId.make('1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'),
		live: Option.none(),
		number: '9541',
		operator: 'trenitalia',
		operatorName: 'Frecciarossa',
		seat: Option.none(),
		status: 'confirmed',
		to: Schema.decodeSync(BookedPlace)({name: 'Milano Centrale', timeZone: 'Europe/Rome'})
	}),
	Struct.keys(Train.fields)
)

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

it('finds the booked stops by Trenitalia code, else by their printed names', () => {
	const arrived = trainTracking(
		Schema.decodeSync(VtStatus)({
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
		}),
		Train.make({
			...train,
			from: Schema.decodeSync(Train.json.fields.from)({
				code: 'it-trenitalia_08409:station',
				name: 'Roma',
				timeZone: 'Europe/Rome'
			}),
			to: Schema.decodeSync(Train.json.fields.to)({name: 'Bologna Centrale', timeZone: 'Europe/Rome'})
		}),
		DateTime.makeUnsafe(1)
	)
	assert.deepStrictEqual(
		Option.map(arrived, found => [found.departurePlatform, found.arrivalPlatform, found.state]),
		Option.some([Option.some('3'), Option.some('14'), 'arrived'])
	)
})

it('reads the platform, the delay it left with and the delay it runs with at the booked stop', () => {
	const waiting = trainTracking(
		Schema.decodeSync(VtStatus)({
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
		}),
		train,
		DateTime.makeUnsafe(1)
	)
	assert.deepStrictEqual(
		Option.map(
			waiting,
			found =>
				[
					found.state,
					found.departurePlatform,
					found.departurePlatformPlanned,
					found.delayMinutes,
					found.departureDelay,
					found.lastSeen
				] as const
		),
		Option.some([
			'scheduled',
			Option.some('12'),
			Option.some('9'),
			Duration.minutes(6),
			Option.none<Duration.Duration>(),
			Option.none<{at: DateTime.Utc; station: string}>()
		] as const)
	)
	const left = trainTracking(
		Schema.decodeSync(VtStatus)({
			fermate: [{id: 'S08409', partenzaReale: 1, programmata: 0, ritardo: 3, stazione: 'ROMA TERMINI'}],
			ritardo: 8
		}),
		train,
		DateTime.makeUnsafe(2)
	)
	assert.deepStrictEqual(
		Option.map(left, found => [found.state, found.departureDelay, found.delayMinutes]),
		Option.some(['departed', Option.some(Duration.minutes(3)), Duration.minutes(8)])
	)
})

it('checks a train each minute near departure and calls live data stale after two missed checks', () => {
	const departs = DateTime.makeUnsafe('2026-10-28T15:40:00Z')
	const timetable = Train.make({...train, arrives: DateTime.addDuration(departs, Duration.hours(3)), departs})
	const flight = Flight.make({
		airline: 'British Airways',
		airlineCode: 'BA',
		arrives: DateTime.addDuration(departs, Duration.hours(2.5)),
		boardingAt: Option.none(),
		boardingGroup: Option.none(),
		confirmation: Option.none(),
		departs,
		from: Schema.decodeSync(BookedPlace)({city: 'Rome', code: 'FCO', name: 'Fiumicino', timeZone: 'Europe/Rome'}),
		id: BookingId.make('7f0c8f8e-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
		live: Option.none(),
		number: '553',
		seat: Option.none(),
		status: 'confirmed',
		to: Schema.decodeSync(BookedPlace)({city: 'London', code: 'LHR', name: 'Heathrow', timeZone: 'Europe/London'})
	})
	const now = DateTime.subtractDuration(departs, Duration.minutes(30))
	function live(checkedAt: DateTime.Utc, operator: Train['operator'] = 'trenitalia') {
		return Train.make({
			...train,
			arrives: timetable.arrives,
			departs: timetable.departs,
			live: Option.some(
				Schema.decodeSync(TrainTracking)({
					checkedAt: DateTime.toEpochMillis(checkedAt),
					delayMinutes: 0,
					state: 'scheduled'
				})
			),
			operator
		})
	}
	assert.deepStrictEqual(
		[
			checkEvery(timetable, now),
			checkEvery(timetable, DateTime.subtractDuration(departs, Duration.hours(3))),
			checkEvery(flight, DateTime.subtractDuration(departs, Duration.hours(3)))
		],
		[Option.some(Duration.minutes(1)), Option.some(Duration.minutes(30)), Option.some(Duration.minutes(20))]
	)
	assert.deepStrictEqual(
		[
			isStale(live(DateTime.subtractDuration(now, Duration.minutes(2))), now),
			isStale(live(DateTime.subtractDuration(now, Duration.minutes(5))), now)
		],
		[false, true]
	)
	assert.deepStrictEqual(
		[
			isStale(live(now), DateTime.addDuration(timetable.arrives, Duration.hours(1))),
			isStale(
				Train.make({
					...train,
					arrives: timetable.arrives,
					departs: timetable.departs,
					live: Option.some(
						Schema.decodeSync(TrainTracking)({
							checkedAt: DateTime.toEpochMillis(now),
							delayMinutes: 0,
							state: 'arrived'
						})
					)
				}),
				DateTime.addDuration(timetable.arrives, Duration.hours(1))
			)
		],
		[true, false]
	)
	assert.deepStrictEqual(
		[
			checkEvery(
				Train.make({...train, arrives: timetable.arrives, departs: timetable.departs, operator: 'other'}),
				now
			),
			isStale(live(DateTime.makeUnsafe(0), 'other'), now)
		],
		[Option.none(), false]
	)
})
