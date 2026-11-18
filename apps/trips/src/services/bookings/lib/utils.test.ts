import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Function, Option, Schema, Struct} from 'effect'

import {
	activeWindow,
	arrivalClockOf,
	autoStartOf,
	changeOf,
	dayMark,
	daysBetween,
	instantOf,
	journeysOf,
	journeyProps,
	realIssueDate,
	segmentOf,
	startable,
	stayAfter,
	upsert
} from '#services/bookings/lib/utils.ts'
import {
	BookedPlace,
	Booking,
	BookingId,
	Flight,
	FlightTracking,
	PlaceCode,
	Stay,
	Train,
	TrainStop,
	TrainTracking
} from '#services/bookings/schema.ts'

const DEPARTS = DateTime.makeUnsafe('2026-10-28T15:40:00Z')

function train(id: string, from: string, to: string, departure: string, arrival: string) {
	return Train.make({
		arrives: DateTime.makeUnsafe(arrival),
		coach: Option.none(),
		confirmation: Option.none(),
		departs: DateTime.makeUnsafe(departure),
		from: Schema.decodeSync(BookedPlace)({name: from, timeZone: 'Europe/Rome'}),
		id: BookingId.make(id),
		issued: Option.none(),
		live: Option.none(),
		number: '9713',
		operator: 'TRENITALIA',
		seat: Option.none(),
		service: 'FR 9713',
		status: 'confirmed',
		stops: [],
		to: Schema.decodeSync(BookedPlace)({name: to, timeZone: 'Europe/Rome'})
	})
}

it('chains confirmed trains at matching stations within three hours and shows the current leg', () => {
	const first = train(
		'11111111-1111-4111-8111-111111111111',
		'Milano',
		'Venezia Mestre',
		'2026-11-18T08:00Z',
		'2026-11-18T10:00Z'
	)
	const next = train(
		'22222222-2222-4222-8222-222222222222',
		'VENEZIA MESTRE',
		'Trieste',
		'2026-11-18T10:14Z',
		'2026-11-18T12:00Z'
	)
	assert.deepStrictEqual(journeysOf([next, first]), [[first, next]])
	assert.strictEqual(
		journeyProps([first, next], [], first.departs, Function.constFalse).note,
		'Change at Venezia Mestre · 14 min'
	)
	assert.strictEqual(journeyProps([first, next], [], first.arrives, Function.constFalse).from, next.from.name)
	assert.strictEqual(
		journeysOf([first, Train.make({...Struct.pick(next, Struct.keys(Train.fields)), status: 'cancelled'})]).length,
		2
	)
	assert.strictEqual(
		journeysOf([
			first,
			Train.make({
				...Struct.pick(next, Struct.keys(Train.fields)),
				departs: DateTime.addDuration(first.arrives, Duration.hours(3))
			})
		]).length,
		1
	)
	assert.strictEqual(
		journeysOf([
			first,
			Train.make({
				...Struct.pick(next, Struct.keys(Train.fields)),
				departs: DateTime.addDuration(first.arrives, Duration.minutes(181))
			})
		]).length,
		2
	)
	assert.strictEqual(
		journeysOf([
			first,
			Train.make({
				...Struct.pick(next, Struct.keys(Train.fields)),
				departs: DateTime.subtractDuration(first.arrives, Duration.minutes(1))
			})
		]).length,
		2
	)
	assert.strictEqual(startable([first, next], DateTime.subtractDuration(first.departs, Duration.hours(7))), true)
	assert.strictEqual(startable([first, next], DateTime.subtractDuration(first.departs, Duration.minutes(421))), false)
	assert.strictEqual(startable([first, next], next.arrives), false)
	assert.deepStrictEqual(autoStartOf([first, next]), DateTime.subtractDuration(first.departs, Duration.hours(1)))
	assert.deepStrictEqual(
		Option.map(activeWindow(first, first.departs, [first, next]), window => window.end),
		Option.some(DateTime.addDuration(next.arrives, Duration.minutes(10)))
	)
})

it('samples at most seven scheduled stops with endpoints and delayed passage', () => {
	const stops = Array.makeBy(10, index =>
		Schema.decodeSync(TrainStop)({
			departs: DateTime.toEpochMillis(DateTime.addDuration(DEPARTS, Duration.minutes(index))),
			name: `Station${index} Centrale`
		})
	)
	const booking = train(
		'11111111-1111-4111-8111-111111111111',
		'Milano',
		'Roma',
		DateTime.formatIso(DEPARTS),
		DateTime.formatIso(DateTime.addDuration(DEPARTS, Duration.hours(1)))
	)
	function activityStops(scheduled: readonly TrainStop[], delay: number, now: DateTime.Utc) {
		return Option.getOrThrow(
			journeyProps(
				[
					Train.make({
						...Struct.pick(booking, Struct.keys(Train.fields)),
						live: Option.some(Schema.decodeSync(TrainTracking)({checkedAt: 1, delayMinutes: delay, state: 'departed'})),
						stops: [...scheduled]
					})
				],
				[],
				now,
				Function.constFalse
			).stops
		)
	}
	assert.deepStrictEqual(
		Array.map(activityStops(stops, 2, DateTime.addDuration(DEPARTS, Duration.minutes(5))), stop => [
			stop.name,
			stop.passed
		]),
		[
			['Station0', true],
			['Station2', true],
			['Station3', true],
			['Station5', false],
			['Station6', false],
			['Station8', false],
			['Station9', false]
		]
	)
	assert.deepStrictEqual(activityStops([], 0, DEPARTS), [])
	assert.strictEqual(activityStops(Array.take(stops, 3), 0, DEPARTS).length, 3)
})

const FLIGHT = Struct.pick(
	Flight.make({
		airline: 'British Airways',
		airlineCode: 'BA',
		arrives: DateTime.addDuration(DEPARTS, Duration.hours(2.5)),
		boardingAt: Option.none(),
		boardingGroup: Option.none(),
		confirmation: Option.none(),
		departs: DEPARTS,
		from: Schema.decodeSync(BookedPlace)({code: 'FCO', name: 'Fiumicino', timeZone: 'Europe/Rome'}),
		id: BookingId.make('7f0c8f8e-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
		issued: Option.none(),
		live: Option.none(),
		number: '553',
		seat: Option.none(),
		status: 'confirmed',
		to: Schema.decodeSync(BookedPlace)({code: 'LHR', name: 'Heathrow', timeZone: 'Europe/London'})
	}),
	Struct.keys(Flight.fields)
)

it('reads local ticket times in the place zone and explicit offsets as given', () => {
	assert.deepStrictEqual(instantOf('2026-10-28T16:40', Option.some('Europe/Rome')), Option.some(DEPARTS))
	assert.deepStrictEqual(instantOf('2026-10-28T17:40+02:00', Option.some('Europe/London')), Option.some(DEPARTS))
	assert.deepStrictEqual(instantOf('2026-10-28T17:40+02:00', Option.none()), Option.some(DEPARTS))
	assert.deepStrictEqual(instantOf('2026-10-28T15:40Z', Option.none()), Option.some(DEPARTS))
	assert.deepStrictEqual(instantOf('2026-10-28T16:40', Option.none()), Option.none())
})

it('reads no moment from a date or clock the place never shows', () => {
	assert.deepStrictEqual(
		[
			instantOf('2026-02-30T12:00', Option.some('Europe/Rome')),
			instantOf('2026-02-30T12:00+01:00', Option.none()),
			instantOf('2026-03-29T02:30', Option.some('Europe/Rome')),
			instantOf('2026-10-28T25:10', Option.some('Europe/Rome'))
		],
		[Option.none(), Option.none(), Option.none(), Option.none()]
	)
	// The hour repeated as summer time ends reads as its first occurrence.
	assert.deepStrictEqual(
		instantOf('2026-10-25T02:30', Option.some('Europe/Rome')),
		Option.some(DateTime.makeUnsafe('2026-10-25T00:30:00Z'))
	)
})

it('counts calendar days between local dates and marks an arrival on another date', () => {
	assert.deepStrictEqual(
		[
			daysBetween(
				DateTime.makeUnsafe('2026-11-19T14:50:00Z'),
				'Asia/Tokyo',
				DateTime.makeUnsafe('2026-11-19T09:50:00Z'),
				'Pacific/Honolulu'
			),
			daysBetween(
				DateTime.makeUnsafe('2026-11-19T21:30:00Z'),
				'Europe/Rome',
				DateTime.makeUnsafe('2026-11-20T08:00:00Z'),
				'Europe/Rome'
			)
		],
		[-1, 1]
	)
	assert.deepStrictEqual([dayMark(0), dayMark(1), dayMark(-1)], ['', ' +1', ' −1'])
	assert.strictEqual(
		arrivalClockOf(
			Flight.make({
				...FLIGHT,
				arrives: DateTime.makeUnsafe('2026-10-29T06:30:00Z'),
				departs: DateTime.makeUnsafe('2026-10-28T21:00:00Z')
			})
		),
		'06:30 +1'
	)
})

it('puts a connection at risk when the first train arrives after the next one leaves', () => {
	const first = train(
		'11111111-1111-4111-8111-111111111111',
		'Milano',
		'Verona',
		'2026-11-18T08:00Z',
		'2026-11-18T09:00Z'
	)
	const next = train(
		'22222222-2222-4222-8222-222222222222',
		'Verona',
		'Venezia',
		'2026-11-18T09:20Z',
		'2026-11-18T10:30Z'
	)
	const late = Train.make({
		...Struct.pick(first, Struct.keys(Train.fields)),
		live: Option.some(Schema.decodeSync(TrainTracking)({checkedAt: 1, delayMinutes: 30, state: 'departed'}))
	})
	assert.deepStrictEqual(
		[changeOf(first, next), changeOf(late, next)],
		['Change at Verona · 20 min', 'Connection at risk at Verona']
	)
})

function stay(id: string, city: string) {
	return Stay.make({
		checkIn: DateTime.makeUnsafe('2026-11-18T10:00Z'),
		checkOut: DateTime.makeUnsafe('2026-11-19T09:00Z'),
		confirmation: Option.none(),
		id: BookingId.make(id),
		issued: Option.none(),
		name: `Hotel in ${city}`,
		place: Schema.decodeSync(BookedPlace)({
			address: `Via Roma 1, ${city}, Italy`,
			city,
			name: `Hotel in ${city}`,
			timeZone: 'Europe/Rome'
		}),
		status: 'confirmed'
	})
}

it('offers a stay as the next stop only in the city the journey reaches', () => {
	const arriving = train(
		'11111111-1111-4111-8111-111111111111',
		'Milano Centrale',
		'Verona Porta Nuova',
		'2026-11-18T08:00Z',
		'2026-11-18T09:00Z'
	)
	const rome = stay('33333333-3333-4333-8333-333333333333', 'Roma')
	const verona = stay('44444444-4444-4444-8444-444444444444', 'Verona')
	assert.deepStrictEqual(
		[
			Option.map(stayAfter([rome], arriving), found => found.name),
			Option.map(stayAfter([rome, verona], arriving), found => found.name)
		],
		[Option.none(), Option.some('Hotel in Verona')]
	)
})

it('starts no Live Activity for a cancelled journey', () => {
	const departing = train(
		'11111111-1111-4111-8111-111111111111',
		'Milano',
		'Verona',
		'2026-11-18T08:00Z',
		'2026-11-18T09:00Z'
	)
	const cancelled = Train.make({
		...Struct.pick(departing, Struct.keys(Train.fields)),
		live: Option.some(Schema.decodeSync(TrainTracking)({checkedAt: 1, delayMinutes: 0, state: 'cancelled'}))
	})
	assert.deepStrictEqual(
		[startable([departing], departing.departs), startable([cancelled], departing.departs)],
		[true, false]
	)
})

it('merges tickets for the same leg and retains live data only while its schedule matches', () => {
	const tracked = Flight.make({
		...FLIGHT,
		confirmation: Option.some('ABC123'),
		live: Option.some(Schema.decodeSync(FlightTracking)({checkedAt: 1, departureGate: 'B12', state: 'scheduled'}))
	})
	const again = Flight.make({
		...FLIGHT,
		id: BookingId.make('aaaaaaaa-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
		seat: Option.some('14A')
	})
	assert.deepStrictEqual(
		Array.map(upsert([tracked], [again]), booking => [
			booking.id,
			booking.confirmation,
			Booking.isAnyOf(['flight'])(booking) && booking.seat,
			Booking.isAnyOf(['flight'])(booking) && Option.flatMap(booking.live, live => live.departureGate)
		]),
		[[FLIGHT.id, Option.some('ABC123'), Option.some('14A'), Option.some('B12')]]
	)
	assert.deepStrictEqual(
		Array.map(
			upsert(
				[tracked],
				[
					Flight.make({
						...FLIGHT,
						departs: DateTime.addDuration(DEPARTS, Duration.hours(3)),
						id: again.id,
						seat: again.seat
					})
				]
			),
			booking => Booking.isAnyOf(['flight'])(booking) && booking.live
		),
		[Option.none()]
	)
})

it('reads an issue date no calendar has as no date', () => {
	assert.deepStrictEqual(
		Array.map(['2026-11-01', '2024-02-29', '9999-99-99', '2026-02-30', '2026-13-01'], date =>
			realIssueDate(Option.some(date))
		),
		[Option.some('2026-11-01'), Option.some('2024-02-29'), Option.none(), Option.none(), Option.none()]
	)
})

it('keeps distinct legs of the same flight number as distinct bookings', () => {
	assert.lengthOf(
		upsert(
			[FLIGHT],
			[
				Flight.make({
					...FLIGHT,
					departs: DateTime.addDuration(DEPARTS, Duration.hours(15)),
					from: FLIGHT.to,
					id: BookingId.make('bbbbbbbb-0d0a-4a5e-9d8f-5b2a1c3d4e5f'),
					to: FLIGHT.from
				})
			]
		),
		2
	)
})

it('splits long flights into departure and arrival activity windows', () => {
	const long = Flight.make({...FLIGHT, arrives: DateTime.addDuration(DEPARTS, Duration.hours(11))})
	assert.deepStrictEqual(
		Array.map([-1, 2, 10], hours =>
			Option.map(activeWindow(long, DateTime.addDuration(DEPARTS, Duration.hours(hours))), window => window.leg)
		),
		[Option.some('departure'), Option.none(), Option.some('arrival')]
	)
	assert.deepStrictEqual(
		Option.map(activeWindow(FLIGHT, DateTime.addDuration(DEPARTS, Duration.hours(2))), window => window.leg),
		Option.some('departure')
	)
})

function transitStop(stopId: string, name: string) {
	return {
		arrival: Option.none(),
		departure: Option.none(),
		lat: 0,
		lon: 0,
		name,
		stopId: PlaceCode.make(stopId),
		tz: 'Europe/Rome'
	}
}

const RUN = [
	transitStop('rm', 'ROMA TERMINI'),
	transitStop('mr', 'MILANO ROGOREDO'),
	transitStop('mc', 'MILANO CENTRALE')
]

function ends(found: ReturnType<typeof segmentOf>) {
	return Option.map(found, segment => [Array.map(segment.stops, item => item.stopId), segment.rank])
}

it('ends a train at the exact station even when a looser match comes first', () => {
	const from = {code: Option.some('rm'), name: 'Roma Termini'}
	assert.deepStrictEqual(
		ends(segmentOf(RUN, from, {code: Option.none(), name: 'Milano Centrale'})),
		Option.some([['rm', 'mr', 'mc'], 1])
	)
	// The stop id Transitous named for the printed station wins over a spelling that matches Rogoredo as loosely.
	assert.deepStrictEqual(
		ends(segmentOf(RUN, from, {code: Option.some('mc'), name: 'Milano C.le'})),
		Option.some([['rm', 'mr', 'mc'], 0])
	)
})
