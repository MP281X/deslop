import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Option, Schema, Struct} from 'effect'

import {journeysOf, stepOf} from '#services/flights/lib/utils.ts'
import type {Journey} from '#services/flights/lib/utils.ts'
import {FlightId, Flight, FlightTracking, Place, PlaceCode, TravelTime} from '#services/flights/schema.ts'
import {activeWindow, activityProps} from '#services/push/lib/utils.ts'

// Monday 23 November: FR 1234 Bergamo → Stansted at 10:30 (09:30Z), 50 min late; FR 206 Stansted → Dublin at 13:40. Bergamo is two hours from home.
const BERGAMO = Schema.decodeSync(Place)({city: 'Bergamo', code: 'BGY', name: 'Milan Bergamo', timeZone: 'Europe/Rome'})
const STANSTED = Schema.decodeSync(Place)({
	city: 'London',
	code: 'STN',
	name: 'London Stansted',
	timeZone: 'Europe/London'
})
const DUBLIN = Schema.decodeSync(Place)({city: 'Dublin', code: 'DUB', name: 'Dublin', timeZone: 'Europe/Dublin'})
const TRAVEL = [TravelTime.make({airport: PlaceCode.make('BGY'), minutes: 120})]

function at(time: string) {
	return DateTime.makeUnsafe(`2026-11-23T${time}:00Z`)
}

type Booked = {arrives: DateTime.Utc; departs: DateTime.Utc; from: Place; id: FlightId; number: string; to: Place}

// A Ryanair flight as booked, with `extra` fields from its pass, as a plain record to spread.
function flight(booked: Booked, extra: Partial<Flight> = {}) {
	return Struct.pick(
		Flight.make({
			airline: 'Ryanair',
			airlineCode: 'FR',
			boardingAt: Option.none(),
			live: Option.none(),
			travellers: [],
			...booked,
			...extra
		}),
		Struct.keys(Flight.fields)
	)
}

// One traveller still booked under the day's reservation.
function traveller(name: string, seat: string) {
	return {
		boardingGroup: Option.none(),
		boardingPass: true,
		confirmation: Option.some('RYR123'),
		name: Option.some(name),
		seat: Option.some(seat),
		status: 'confirmed' as const,
		ticket: Option.none()
	}
}

function live(fields: Partial<typeof FlightTracking.Encoded>) {
	return Option.some(Schema.decodeSync(FlightTracking)({checkedAt: 0, state: 'scheduled', ...fields}))
}

const FIRST = flight(
	{
		arrives: at('11:35'),
		departs: at('09:30'),
		from: BERGAMO,
		id: FlightId.make('11111111-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
		number: '1234',
		to: STANSTED
	},
	{
		boardingAt: Option.some(at('09:00')),
		travellers: [traveller('Matteo Rossi', '14C'), traveller('Anna Bianchi', '14D')]
	}
)
const SECOND = flight({
	arrives: at('15:00'),
	departs: at('13:40'),
	from: STANSTED,
	id: FlightId.make('22222222-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
	number: '206',
	to: DUBLIN
})

// The first flight as FlightAware tells it at each moment of the day.
function day(first: Option.Option<FlightTracking>, second = SECOND.live) {
	return Array.make(Flight.make({...FIRST, live: first}), Flight.make({...SECOND, live: second}))
}

const LATE = {departureEstimated: DateTime.toEpochMillis(at('10:20')), inboundDelay: 50}
const LANDS = {arrivalEstimated: DateTime.toEpochMillis(at('12:25'))}

function shown(journey: Journey, now: DateTime.Utc) {
	const props = activityProps(journey, stepOf(journey, now, TRAVEL), TRAVEL, false)
	return {
		deadline: Option.map(props.deadline, DateTime.formatIso),
		label: props.label,
		phase: props.phase,
		since: DateTime.formatIso(props.since),
		value: props.value,
		was: props.was
	}
}

it('groups flights that leave from where the one before lands into one day', () => {
	const later = Flight.make({
		...SECOND,
		arrives: DateTime.addDuration(at('23:59'), Duration.hours(1)),
		departs: at('23:59'),
		id: FlightId.make('33333333-0d0a-4a5e-9d8f-5b2a1c3d4e5f')
	})
	assert.deepStrictEqual(
		Array.map(journeysOf([Flight.make(SECOND), Flight.make(FIRST), later]), journey =>
			Array.map(journey, item => item.number)
		),
		[['1234', '206'], ['206']]
	)
	// Once every booking on the first flight is cancelled, the second is reached from home and starts a day of its own.
	const cancelled = Flight.make({
		...FIRST,
		travellers: Array.map(FIRST.travellers, held => ({...held, status: 'cancelled' as const}))
	})
	assert.deepStrictEqual(
		Array.map(journeysOf([cancelled, Flight.make(SECOND)]), journey => Array.map(journey, item => item.number)),
		[['1234'], ['206']]
	)
})

it('walks the day from leave by through airport by, the gate, boarding and the flight, the ring draining to each deadline', () => {
	assert.deepStrictEqual(
		[
			shown(day(Option.none()), at('06:15')),
			shown(day(live(LATE)), at('07:35')),
			shown(day(live({...LATE, departureGate: 'A6'})), at('08:45')),
			shown(day(live({...LATE, departureGate: 'A8', previousGate: 'A6'})), at('09:02')),
			shown(day(live({...LATE, departureGate: 'A8', previousGate: 'A6'})), at('09:50'))
		],
		[
			{
				deadline: Option.some('2026-11-23T06:30:00.000Z'),
				label: 'Leave by',
				phase: 'leave',
				since: '2026-11-23T06:15:00.000Z',
				value: '07:30',
				was: Option.none()
			},
			{
				deadline: Option.some('2026-11-23T08:30:00.000Z'),
				label: 'Airport by',
				phase: 'airport',
				since: '2026-11-23T06:30:00.000Z',
				value: '09:30',
				was: Option.none()
			},
			// Boarding moves with the delay: the pass's 10:00 is 10:50.
			{
				deadline: Option.some('2026-11-23T09:50:00.000Z'),
				label: 'Gate',
				phase: 'gate',
				since: '2026-11-23T08:30:00.000Z',
				value: 'A6',
				was: Option.none()
			},
			{
				deadline: Option.some('2026-11-23T09:50:00.000Z'),
				label: 'Gate',
				phase: 'gate',
				since: '2026-11-23T08:30:00.000Z',
				value: 'A8',
				was: Option.some('A6')
			},
			{
				deadline: Option.some('2026-11-23T10:20:00.000Z'),
				label: 'Boarding at gate',
				phase: 'boarding',
				since: '2026-11-23T09:50:00.000Z',
				value: 'A8',
				was: Option.some('A6')
			}
		]
	)
})

it('hands the day to the connection at landing, its gate not yet posted, and ends landed', () => {
	const airborne = live({
		...LATE,
		...LANDS,
		departureActual: DateTime.toEpochMillis(at('10:22')),
		departureGate: 'A8',
		state: 'airborne',
		takeoffActual: DateTime.toEpochMillis(at('10:31'))
	})
	const landed = live({...LATE, ...LANDS, arrivalActual: DateTime.toEpochMillis(at('12:25')), state: 'arrived'})
	assert.deepStrictEqual(
		[
			shown(day(airborne), at('11:40')),
			shown(day(landed), at('12:27')),
			shown(day(landed, live({arrivalActual: DateTime.toEpochMillis(at('14:58')), state: 'arrived'})), at('15:05'))
		],
		[
			{
				deadline: Option.some('2026-11-23T12:25:00.000Z'),
				label: 'Lands in London, local time',
				phase: 'airborne',
				since: '2026-11-23T10:31:00.000Z',
				value: '12:25',
				was: Option.none()
			},
			// Without a pass, boarding is half an hour before departure.
			{
				deadline: Option.some('2026-11-23T13:10:00.000Z'),
				label: 'Gate for FR 206',
				phase: 'gate',
				since: '2026-11-23T12:25:00.000Z',
				value: 'Not yet',
				was: Option.none()
			},
			{
				deadline: Option.none(),
				label: 'Landed in',
				phase: 'landed',
				since: '2026-11-23T14:58:00.000Z',
				value: 'Dublin',
				was: Option.none()
			}
		]
	)
	const handed = activityProps(day(landed), stepOf(day(landed), at('12:27'), TRAVEL), TRAVEL, false)
	assert.deepStrictEqual(
		[handed.pending, handed.gate, handed.segment, handed.until],
		[true, Option.none(), 1, 'Boards 13:10']
	)
})

function told(journey: Journey, now: DateTime.Utc) {
	const props = activityProps(journey, stepOf(journey, now, TRAVEL), TRAVEL, false)
	return [props.problem, props.tone, props.noteWas]
}

it('names the cause of a delay on the way to the airport, and a tight change once in the air', () => {
	const airborne = live({...LATE, ...LANDS, departureActual: DateTime.toEpochMillis(at('10:22')), state: 'airborne'})
	assert.deepStrictEqual(
		[told(day(live(LATE)), at('07:35')), told(day(airborne), at('11:40'))],
		[
			[Option.some('50 min late: the plane flying in is 50 min late'), 'warn', Option.some('10:30')],
			[Option.some('1h 15m to change in London'), 'warn', Option.none()]
		]
	)
})

it('keeps the day on one activity across the landing, cut only while in the air when the day outlasts ActivityKit', () => {
	// FlightAware keeps the time it left once it left, so the cut stays put.
	const airborne = live({...LATE, ...LANDS, departureActual: DateTime.toEpochMillis(at('10:22')), state: 'airborne'})
	const landed = live({
		...LATE,
		...LANDS,
		arrivalActual: DateTime.toEpochMillis(at('12:25')),
		departureActual: DateTime.toEpochMillis(at('10:22')),
		state: 'arrived'
	})
	assert.deepStrictEqual(
		Array.map(
			[
				activeWindow(day(Option.none()), at('06:14'), TRAVEL),
				activeWindow(day(live(LATE)), at('06:15'), TRAVEL),
				activeWindow(day(airborne), at('12:20'), TRAVEL),
				activeWindow(day(landed), at('12:30'), TRAVEL)
			],
			found =>
				Option.map(found, window => [window.leg, DateTime.formatIso(window.start), DateTime.formatIso(window.end)])
		),
		[
			Option.none(),
			Option.some(['departure', '2026-11-23T06:15:00.000Z', '2026-11-23T11:05:00.000Z']),
			Option.some(['arrival', '2026-11-23T11:07:00.000Z', '2026-11-23T15:45:00.000Z']),
			Option.some(['arrival', '2026-11-23T11:07:00.000Z', '2026-11-23T15:45:00.000Z'])
		]
	)
	// A single flight's day fits one activity: from a quarter of an hour before leaving to three quarters of an hour after landing.
	assert.deepStrictEqual(
		Option.map(activeWindow([FIRST], at('09:00'), TRAVEL), window => [
			window.leg,
			DateTime.formatIso(window.start),
			DateTime.formatIso(window.end)
		]),
		Option.some(['departure', '2026-11-23T06:15:00.000Z', '2026-11-23T12:20:00.000Z'])
	)
})

it('keeps an activity on screen through a long connection, handing over at a moment both activities cover', () => {
	// 09:00–11:00 to Stansted, then 18:00–20:00 to Dublin: the day runs 06:00–20:45, longer than one activity.
	const long = Array.make(
		Flight.make({...FIRST, arrives: at('11:00'), boardingAt: Option.none(), departs: at('09:00')}),
		Flight.make({...SECOND, arrives: at('20:00'), departs: at('18:00')})
	)
	const windows = Array.map(['06:00', '09:45', '11:00', '13:15', '13:22', '13:23', '20:44'], time =>
		Option.map(activeWindow(long, at(time), []), window => [
			window.leg,
			DateTime.formatIso(window.start),
			DateTime.formatIso(window.end)
		])
	)
	const first = Option.some(['departure', '2026-11-23T06:00:00.000Z', '2026-11-23T13:22:30.000Z'])
	const second = Option.some(['arrival', '2026-11-23T13:22:30.000Z', '2026-11-23T20:45:00.000Z'])
	assert.deepStrictEqual(windows, [first, first, first, first, first, second, second])
	// Every minute of the day has an activity.
	assert.isTrue(
		Array.every(Array.range(0, 14 * 60 + 44), minute =>
			Option.isSome(activeWindow(long, DateTime.addDuration(at('06:00'), Duration.minutes(minute)), []))
		)
	)
})
