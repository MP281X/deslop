import {Array, Boolean, DateTime, Duration, Equal, Function, Number, Option, Order, Result, String, pipe} from 'effect'

import {ActivityProps} from '#contracts'
import type {Flight, FlightList, FlightPhase, FlightTracking, Place, Segment, Traveller, TravelTime} from '#contracts'

export const HOUR = Duration.hours(1)

export function clockAt(time: DateTime.Utc, timeZone: string) {
	return DateTime.format(time, {hour: '2-digit', hourCycle: 'h23', locale: 'en-GB', minute: '2-digit', timeZone})
}

export function isBooked(traveller: Traveller) {
	return traveller.status === 'confirmed'
}

// Whether any reservation on the flight still stands, whatever the provider reports.
export function bookedOf(flight: Flight) {
	return Array.some(flight.travellers, isBooked)
}

// Every reservation on the flight was cancelled, or the provider says the service will not run; alerts, the island and the phone all read this one answer.
export function cancelledOf(flight: Flight) {
	if (Array.isReadonlyArrayNonEmpty(flight.travellers) && !bookedOf(flight)) return true
	return Option.exists<FlightTracking>(flight.live, live => live.state === 'cancelled')
}

export function labelled(label: string, value: Option.Option<string>) {
	return Option.map(value, found => `${label} ${found}`)
}

export function line(parts: Option.Option<string>[]) {
	return Array.join(Array.getSomes(parts), ' · ')
}

// What the travellers still booked share, such as their seats, each told once: "14C, 14D".
export function travellersLine(flight: Flight, field: (traveller: Traveller) => Option.Option<string>) {
	return pipe(
		flight.travellers,
		Array.filter(isBooked),
		Array.filterMap(traveller =>
			Option.match(field(traveller), {onNone: () => Result.failVoid, onSome: Result.succeed})
		),
		Array.dedupe,
		Array.join(', '),
		Option.liftPredicate(String.isNonEmpty)
	)
}

export function departureOf(flight: Flight) {
	return pipe(
		flight.live,
		Option.flatMap(live => Option.orElse(live.departureActual, () => live.departureEstimated)),
		Option.getOrElse(() => flight.departs)
	)
}

// At the airport an hour before the booked departure; a delay never moves it, since an estimate can come back.
export function airportByOf(flight: Flight) {
	return DateTime.subtractDuration(flight.departs, HOUR)
}

// The trip from home to the airport the flight leaves from, as saved for that airport.
export function travelTo(flight: Flight, travel: readonly TravelTime[]) {
	return pipe(
		travel,
		Array.findFirst(saved => Option.contains(flight.from.code, saved.airport)),
		Option.map(saved => Duration.minutes(saved.minutes))
	)
}

// When to leave home for the airport, known once the trip there is saved.
export function leaveByOf(flight: Flight, travel: readonly TravelTime[]) {
	return Option.map(travelTo(flight, travel), trip => DateTime.subtractDuration(airportByOf(flight), trip))
}

export function arrivalOf(flight: Flight) {
	return pipe(
		flight.live,
		Option.flatMap(live => Option.orElse(live.arrivalActual, () => live.arrivalEstimated)),
		Option.getOrElse(() => flight.arrives)
	)
}

// The local date at a place, as midnight UTC of that date, so dates in different zones compare by the calendar.
export function localDate(at: DateTime.Utc, timeZone: string) {
	const parts = DateTime.toParts(DateTime.makeZonedUnsafe(at, {timeZone}))
	return DateTime.makeUnsafe({day: parts.day, month: parts.month, year: parts.year})
}

// The calendar days from one place's local date to another's, as a traveller counts them, whatever the hours between.
export function daysBetween(from: DateTime.Utc, fromZone: string, to: DateTime.Utc, toZone: string) {
	return Number.round(Duration.toDays(DateTime.distance(localDate(from, fromZone), localDate(to, toZone))), 0)
}

// The days a clock lands after or before the day it set out, as boarding passes print it: " +1", " −1" or nothing.
function dayMark(days: number) {
	if (days === 0) return ''
	if (days > 0) return ` +${days}`
	return ` −${-days}`
}

export function arrivalClockOf(flight: Flight) {
	return `${clockAt(arrivalOf(flight), flight.to.timeZone)}${dayMark(daysBetween(departureOf(flight), flight.from.timeZone, arrivalOf(flight), flight.to.timeZone))}`
}

// Soonest first, live delays included.
export const byDeparture = Order.mapInput(DateTime.Order, departureOf)

export function titleOf(flight: Flight) {
	return `${flight.airlineCode} ${flight.number}`
}

export function routeOf(flight: Flight) {
	return `${Option.getOrElse(flight.from.city, () => flight.from.name)} → ${Option.getOrElse(flight.to.city, () => flight.to.name)}`
}

// A field the newer ticket leaves out keeps what the older one printed.
export const HORIZON = Duration.hours(47)
const TRACKED = Duration.hours(46)

// In the air every quarter hour, and every five minutes from 45 minutes before the landing to a quarter hour after it.
function airbornePace(flight: Flight, now: DateTime.Utc) {
	const lands = arrivalOf(flight)
	if (
		DateTime.isGreaterThan(now, DateTime.subtractDuration(lands, Duration.minutes(45))) &&
		DateTime.isLessThan(now, DateTime.addDuration(lands, Duration.minutes(15)))
	) {
		return Duration.minutes(5)
	}
	return Duration.minutes(15)
}

// On the ground the pace quickens at each cutover, inclusive: every two minutes only from 90 minutes out, while the gate is unknown and before the booked departure, then every five.
function groundPace(flight: Flight, now: DateTime.Utc) {
	const left = DateTime.distance(now, departureOf(flight))
	if (Duration.isGreaterThan(left, Duration.hours(24))) return Duration.hours(6)
	if (Duration.isGreaterThan(left, Duration.hours(6))) return Duration.hours(3)
	if (Duration.isGreaterThan(left, Duration.hours(3))) return Duration.minutes(30)
	if (Duration.isGreaterThan(left, Duration.minutes(90))) return Duration.minutes(10)
	if (
		DateTime.isLessThan(now, flight.departs) &&
		!Option.exists(flight.live, live => Option.isSome(live.departureGate))
	) {
		return Duration.minutes(2)
	}
	return Duration.minutes(5)
}

// The pace of checks by how far the flight is: sparse while little can change, every two minutes in the last 90 minutes until the gate is posted, and none once it landed; at most about a hundred lookups a flight against FlightAware's thousand a month.
export function checkEvery(flight: Flight, now: DateTime.Utc) {
	const state = Option.map(flight.live, live => live.state)
	if (
		cancelledOf(flight) ||
		Option.contains(state, 'diverted') ||
		Option.contains(state, 'landed') ||
		Option.contains(state, 'arrived')
	) {
		return Option.none<Duration.Duration>()
	}
	// A flight it never reported landing is let go two hours after it was due.
	if (
		DateTime.isLessThan(now, DateTime.subtractDuration(flight.departs, TRACKED)) ||
		DateTime.isGreaterThan(now, DateTime.addDuration(arrivalOf(flight), Duration.hours(2)))
	) {
		return Option.none<Duration.Duration>()
	}
	// Half an hour past its departure time with no word of takeoff, a flight is paced as if in the air.
	if (
		Option.contains(state, 'airborne') ||
		DateTime.isGreaterThanOrEqualTo(now, DateTime.addDuration(departureOf(flight), Duration.minutes(30)))
	) {
		return Option.some(airbornePace(flight, now))
	}
	return Option.some(groundPace(flight, now))
}

// Live data that missed two of the checks due after it no longer describes the flight, even once tracking stopped; an arrival is final. Checks come at the shorter of the pace when it was read and the pace now, since the pace quickens near departure.
export function isStale(flight: Flight, now: DateTime.Utc) {
	return Option.exists<FlightTracking>(
		flight.live,
		live =>
			live.state !== 'arrived' &&
			pipe(
				Array.getSomes([checkEvery(flight, live.checkedAt), checkEvery(flight, now)]),
				Array.match({
					onEmpty: () => Option.none<Duration.Duration>(),
					onNonEmpty: paces => Option.some(Array.min(paces, Duration.Order))
				}),
				Option.exists(every =>
					pipe(
						live.checkedAt,
						DateTime.distance(now),
						Duration.isGreaterThan(pipe(every, Duration.times(2), Duration.sum(Duration.minutes(2))))
					)
				)
			)
	)
}

// What FlightAware last said while its reports keep coming; once stale, the clock speaks for it.
function reported(flight: Flight, now: DateTime.Utc) {
	return Option.filter(flight.live, () => !isStale(flight, now))
}

// Landed counts as arrived on the phone, the island and the server alike. A report that still has it flying wins over an estimate that passed.
function arrived(flight: Flight, now: DateTime.Utc) {
	if (Option.exists(flight.live, live => live.state === 'arrived' || live.state === 'landed')) return true
	return Option.isNone(reported(flight, now)) && DateTime.isGreaterThanOrEqualTo(now, arrivalOf(flight))
}

// A day of flying: each flight leaves from where the one before it lands. One Live Activity follows it, handed from flight to flight at each landing.
export type Journey = Array.NonEmptyReadonlyArray<Flight>

// He changes from `feeder` to `flight` when it lands where the flight leaves, booked at most twelve hours before it, and still flies: a cancelled feeder leaves him to reach the flight from home. Alerts, the Live Activity's day and Home all read this one rule.
function connects(feeder: Flight, flight: Flight) {
	return (
		feeder.id !== flight.id &&
		!cancelledOf(feeder) &&
		Option.isSome(feeder.to.code) &&
		Equal.equals(feeder.to.code, flight.from.code) &&
		pipe(
			feeder.arrives,
			DateTime.distance(flight.departs),
			change =>
				Duration.isGreaterThan(change, Duration.zero) && Duration.isLessThanOrEqualTo(change, Duration.hours(12))
		)
	)
}

// The flight he changes from, the latest that connects to this one. A flight with one is a connection: no trip from home leads to it, and only the change between the two is told.
export function feederOf(flight: Flight, flights: FlightList) {
	return pipe(
		flights,
		Array.filter(other => connects(other, flight)),
		Array.last
	)
}

// The days in `rest`, soonest first: each takes the flights that leave from where the one before lands.
function daysIn(rest: readonly Flight[]): Journey[] {
	return Array.match(rest, {
		onEmpty: () => [],
		onNonEmpty: flights => {
			const [connected, others] = Array.span(Array.tailNonEmpty(flights), (flight, index) =>
				pipe(
					flights,
					Array.get(index),
					Option.exists(before => connects(before, flight))
				)
			)
			return [Array.prepend(connected, Array.headNonEmpty(flights)), ...daysIn(others)]
		}
	})
}

export function journeysOf(flights: FlightList) {
	return daysIn(Array.sort(flights, byDeparture))
}

export function journeyOf(flights: FlightList, flight: Flight) {
	return Array.findFirst(journeysOf(flights), journey => Array.some(journey, item => item.id === flight.id))
}

// "45 min", or "1h 15m" from an hour.
export function spanLabel(span: Duration.Duration) {
	const minutes = Number.max(0, Number.round(Duration.toMinutes(span), 0))
	if (minutes < 60) return `${minutes} min`
	return `${Math.floor(minutes / 60)}h ${String.padStart(2, '0')(`${Number.remainder(minutes, 60)}`)}m`
}

// The change from `feeder` to `flight` as it stands now, and as booked; it is tight under an hour or once it shrank by fifteen minutes.
export function changeOf(feeder: Flight, flight: Flight) {
	const booked = DateTime.distance(feeder.arrives, flight.departs)
	const now = DateTime.distance(arrivalOf(feeder), departureOf(flight))
	return {
		booked,
		now,
		tight:
			Duration.isLessThan(now, HOUR) ||
			Duration.isLessThanOrEqualTo(now, Duration.subtract(booked, Duration.minutes(15)))
	}
}

// The whole minutes a flight leaves after its booked time, as every alert and screen counts them: 14 min 30 s late is 14.
export function delayOf(flight: Flight) {
	return Math.floor(Duration.toMinutes(DateTime.distance(flight.departs, departureOf(flight))))
}

// The whole minutes it lands after its booked time, counted as a departure's are.
export function landingDelayOf(flight: Flight) {
	return Math.floor(Duration.toMinutes(DateTime.distance(flight.arrives, arrivalOf(flight))))
}

// Boarding as the pass prints it, moved by the delay and never earlier; half an hour before departure without a pass.
export function boardsAt(flight: Flight) {
	return Option.match(flight.boardingAt, {
		onNone: () => DateTime.subtractDuration(departureOf(flight), Duration.minutes(30)),
		onSome: at => DateTime.addDuration(at, Duration.minutes(Number.max(0, delayOf(flight))))
	})
}

// The day's activity opens three hours before the first departure, or a quarter of an hour before leaving home when that is earlier.
export function autoStartOf(journey: Journey, travel: readonly TravelTime[]) {
	const first = Array.headNonEmpty(journey)
	const early = DateTime.subtractDuration(first.departs, Duration.hours(3))
	return pipe(
		leaveByOf(first, travel),
		Option.map(at => DateTime.min(early, DateTime.subtractDuration(at, Duration.minutes(15)))),
		Option.getOrElse(() => early)
	)
}

// One step of the day: its flight, its phase, and the time the ring drains from `since` to `deadline`; the bar's current part fills over its own span.
export type StepAt = {flight: Flight; index: number; phase: FlightPhase; segment: Segment}

export type Step = StepAt & {
	deadline: Option.Option<DateTime.Utc>
	segmentSince: DateTime.Utc
	segmentUntil: DateTime.Utc
	since: DateTime.Utc
}

type Span = {since: DateTime.Utc; until: DateTime.Utc}

function step(at: StepAt, since: DateTime.Utc, deadline: Option.Option<DateTime.Utc>, span?: Span) {
	return {
		...at,
		deadline,
		segmentSince: span?.since ?? since,
		segmentUntil: span?.until ?? Option.getOrElse(deadline, () => since),
		since
	} satisfies Step
}

// Off the ground: FlightAware saw it take off, or without its reports the clock passed the departure. Leaving the gate is not taking off.
function airborne(flight: Flight, now: DateTime.Utc) {
	if (Option.exists(flight.live, live => live.state === 'airborne')) return true
	return Option.isNone(reported(flight, now)) && DateTime.isGreaterThanOrEqualTo(now, departureOf(flight))
}

// The first flight on the way to its airport: leave by, then airport by, then its gate.
function firstStep(journey: Journey, now: DateTime.Utc, travel: readonly TravelTime[]) {
	const flight = Array.headNonEmpty(journey)
	const start = autoStartOf(journey, travel)
	const toAirport = {since: start, until: airportByOf(flight)}
	const leave = leaveByOf(flight, travel)
	if (Option.exists(leave, by => DateTime.isLessThan(now, by))) {
		return step({flight, index: 0, phase: 'leave', segment: 0}, start, leave, toAirport)
	}
	if (DateTime.isLessThan(now, airportByOf(flight))) {
		return step(
			{flight, index: 0, phase: 'airport', segment: 0},
			Option.getOrElse(leave, () => start),
			Option.some(airportByOf(flight)),
			toAirport
		)
	}
	return step({flight, index: 0, phase: 'gate', segment: 1}, airportByOf(flight), Option.some(boardsAt(flight)))
}

function takeoffOf(flight: Flight) {
	return pipe(
		flight.live,
		Option.flatMap(live => Option.orElse(live.takeoffActual, () => live.departureActual)),
		Option.getOrElse(() => departureOf(flight))
	)
}

// A flight that will not fly, that flew or that is flying; none while it is still on the ground.
function flownStep(flight: Flight, index: number, now: DateTime.Utc) {
	const flying = {since: takeoffOf(flight), until: arrivalOf(flight)}
	if (cancelledOf(flight)) {
		return Option.some(step({flight, index, phase: 'cancelled', segment: 0}, flight.departs, Option.none()))
	}
	if (Option.exists(flight.live, live => live.state === 'diverted')) {
		return Option.some(step({flight, index, phase: 'diverted', segment: 3}, takeoffOf(flight), Option.none(), flying))
	}
	if (arrived(flight, now)) {
		return Option.some(step({flight, index, phase: 'landed', segment: 3}, arrivalOf(flight), Option.none(), flying))
	}
	if (airborne(flight, now)) {
		return Option.some(
			step({flight, index, phase: 'airborne', segment: 3}, takeoffOf(flight), Option.some(arrivalOf(flight)))
		)
	}
	return Option.none()
}

// The flight the day is at: the first still to land, or the last once all have. At its landing the day goes on to the next one.
export function legIndexOf(journey: Journey, now: DateTime.Utc) {
	return pipe(
		journey,
		Array.findFirstIndex(flight => cancelledOf(flight) || !arrived(flight, now)),
		Option.getOrElse(() => journey.length - 1)
	)
}

// Where the day stands at its flight; at a landing the day goes on to the next flight's gate.
export function stepOf(journey: Journey, now: DateTime.Utc, travel: readonly TravelTime[]) {
	const index = legIndexOf(journey, now)
	const flight = journey[index] ?? Array.headNonEmpty(journey)
	return Option.getOrElse(flownStep(flight, index, now), () => {
		// Pushed back from the gate and not yet off the ground.
		if (Option.exists(reported(flight, now), live => live.state === 'departed')) {
			return step({flight, index, phase: 'taxiing', segment: 2}, departureOf(flight), Option.none(), {
				since: boardsAt(flight),
				until: departureOf(flight)
			})
		}
		if (DateTime.isGreaterThanOrEqualTo(now, boardsAt(flight))) {
			return step({flight, index, phase: 'boarding', segment: 2}, boardsAt(flight), Option.some(departureOf(flight)))
		}
		return pipe(
			journey,
			Array.get(index - 1),
			Option.match({
				onNone: () => firstStep(journey, now, travel),
				onSome: feeder =>
					step({flight, index, phase: 'gate', segment: 1}, arrivalOf(feeder), Option.some(boardsAt(flight)))
			})
		)
	})
}

export function cityOf(place: Place) {
	return Option.getOrElse(place.city, () => place.name)
}

// The change to the next flight while it is tight, in words: "1h 15m to change in London".
function changeLine(journey: Journey, index: number) {
	return pipe(
		Option.all({feeder: Array.get(journey, index), next: Array.get(journey, index + 1)}),
		Option.filter(found => changeOf(found.feeder, found.next).tight && !cancelledOf(found.next)),
		Option.map(found => {
			const change = changeOf(found.feeder, found.next).now
			if (Duration.isLessThanOrEqualTo(change, Duration.zero)) {
				return `${titleOf(found.next)} may leave before ${titleOf(found.feeder)} lands`
			}
			return `${spanLabel(change)} to change in ${cityOf(found.feeder.to)}`
		})
	)
}

// A delay of a quarter of an hour or more, with its cause when the plane flying in is as late.
function delayLine(flight: Flight) {
	return pipe(
		flight.live,
		Option.flatMap(live => live.inboundDelay),
		Option.map(Duration.toMinutes),
		Option.filter(late => late >= 15),
		Option.match({
			onNone: () => `${delayOf(flight)} min late`,
			onSome: late => `${delayOf(flight)} min late: the plane flying in is ${late} min late`
		}),
		Option.liftPredicate(() => delayOf(flight) >= 15 && Option.isSome(flight.live))
	)
}

// The zones differ at that moment, so a clock in the destination's zone says so.
function otherZone(flight: Flight) {
	return (
		DateTime.zonedOffset(DateTime.makeZonedUnsafe(arrivalOf(flight), {timeZone: flight.from.timeZone})) !==
		DateTime.zonedOffset(DateTime.makeZonedUnsafe(arrivalOf(flight), {timeZone: flight.to.timeZone}))
	)
}

// Who flies and where they sit, by first name: "Matteo 14C · Anna 14D", or the seats alone for a ticket without names.
function seatsLine(flight: Flight) {
	return pipe(
		flight.travellers,
		Array.map(traveller =>
			Option.map(
				Option.all({name: traveller.name, seat: traveller.seat}),
				found => `${Array.headNonEmpty(String.split(found.name, ' '))} ${found.seat}`
			)
		),
		Array.getSomes,
		Array.match({
			onEmpty: () =>
				labelled(
					'Seats',
					travellersLine(flight, traveller => traveller.seat)
				),
			onNonEmpty: seats => Option.some(Array.join(seats, ' · '))
		})
	)
}

const QUIET = {gate: Option.none(), noteWas: Option.none(), pending: false, untilValue: '', was: Option.none()}

function departsNote(flight: Flight) {
	const late = delayOf(flight) >= 5
	return {
		note: `Departs ${clockAt(departureOf(flight), flight.from.timeZone)}`,
		noteTone: Boolean.match(late, {
			onFalse: Function.constant('plain' as const),
			onTrue: Function.constant('warn' as const)
		}),
		noteWas: Option.liftPredicate(clockAt(flight.departs, flight.from.timeZone), () => late)
	}
}

function gateOf(flight: Flight) {
	return Option.flatMap(flight.live, live => live.departureGate)
}

// The gate it left, struck through beside the gate it moved to.
function movedFrom(flight: Flight) {
	return pipe(
		flight.live,
		Option.flatMap(live => live.previousGate),
		Option.filter(() => Option.isSome(gateOf(flight)))
	)
}

function homeWords(flight: Flight, leave: boolean, travel: readonly TravelTime[]) {
	return {
		...QUIET,
		...departsNote(flight),
		label: Boolean.match(leave, {onFalse: Function.constant('Airport by'), onTrue: Function.constant('Leave by')}),
		small: `${titleOf(flight)} · ${routeOf(flight)}`,
		symbol: 'car.fill' as const,
		until: 'Time left',
		value: clockAt(
			pipe(
				leaveByOf(flight, travel),
				Option.filter(() => leave),
				Option.getOrElse(() => airportByOf(flight))
			),
			flight.from.timeZone
		)
	}
}

// The gate, or for a connection the gate of the flight he changes to, with the route since it is a new flight; its number is in the label then. The seats follow bare, so the line fits beside the departure in the Duo's island.
function gateWords(flight: Flight, connection: boolean) {
	const seats = travellersLine(flight, traveller => traveller.seat)
	return {
		...QUIET,
		...departsNote(flight),
		gate: gateOf(flight),
		label: Boolean.match(connection, {onFalse: Function.constant('Gate'), onTrue: () => `Gate for ${titleOf(flight)}`}),
		pending: Option.isNone(gateOf(flight)),
		small: line([
			Option.some(Boolean.match(connection, {onFalse: () => titleOf(flight), onTrue: () => routeOf(flight)})),
			seats
		]),
		symbol: 'airplane.departure' as const,
		until: `Boards ${clockAt(boardsAt(flight), flight.from.timeZone)}`,
		value: Option.getOrElse(gateOf(flight), Function.constant('Not yet')),
		was: movedFrom(flight)
	}
}

function boardingWords(flight: Flight) {
	return {
		...QUIET,
		gate: gateOf(flight),
		label: Option.match(gateOf(flight), {
			onNone: Function.constant('Boarding'),
			onSome: Function.constant('Boarding at gate')
		}),
		note: `Lands ${arrivalClockOf(flight)}`,
		noteTone: 'plain' as const,
		small: line([Option.some(titleOf(flight)), seatsLine(flight)]),
		symbol: 'airplane.departure' as const,
		until: `Departs ${clockAt(departureOf(flight), flight.from.timeZone)}`,
		value: Option.getOrElse(gateOf(flight), Function.constant('Now')),
		was: movedFrom(flight)
	}
}

// Away from the gate, waiting to take off: when it left, and when it lands.
function taxiWords(flight: Flight) {
	return {
		...QUIET,
		label: 'Left the gate at',
		note: '',
		noteTone: 'plain' as const,
		small: line([Option.some(titleOf(flight)), seatsLine(flight)]),
		symbol: 'airplane.departure' as const,
		until: 'Lands',
		untilValue: arrivalClockOf(flight),
		value: clockAt(departureOf(flight), flight.from.timeZone)
	}
}

// The landing in the destination's clock; landing in another zone the small print says so in place of the route, since the label fits the Duo's island only on one line.
function airborneWords(flight: Flight, next: Option.Option<Flight>) {
	return {
		...QUIET,
		label: `Lands in ${cityOf(flight.to)}`,
		note: Option.match(next, {
			onNone: () => `Departed ${clockAt(departureOf(flight), flight.from.timeZone)}`,
			onSome: found => `${titleOf(found)} at ${clockAt(departureOf(found), found.from.timeZone)}`
		}),
		noteTone: 'plain' as const,
		small: Boolean.match(otherZone(flight), {
			onFalse: () => `${titleOf(flight)} · ${routeOf(flight)}`,
			onTrue: () => `${titleOf(flight)} · ${cityOf(flight.to)} time`
		}),
		symbol: 'airplane' as const,
		until: 'Time left',
		value: arrivalClockOf(flight)
	}
}

function landedWords(flight: Flight) {
	return {
		...QUIET,
		label: 'Landed in',
		note: '',
		noteTone: 'plain' as const,
		small: `${titleOf(flight)} · ${routeOf(flight)}`,
		symbol: 'airplane.arrival' as const,
		until: 'At',
		untilValue: arrivalClockOf(flight),
		value: cityOf(flight.to)
	}
}

function stoppedWords(flight: Flight, cancelled: boolean) {
	return {
		...QUIET,
		label: titleOf(flight),
		note: '',
		noteTone: 'plain' as const,
		small: routeOf(flight),
		symbol: 'exclamationmark.triangle.fill' as const,
		until: Boolean.match(cancelled, {
			onFalse: Function.constant('Was to land'),
			onTrue: Function.constant('Was to depart')
		}),
		untilValue: Boolean.match(cancelled, {
			onFalse: () => clockAt(flight.arrives, flight.to.timeZone),
			onTrue: () => clockAt(flight.departs, flight.from.timeZone)
		}),
		value: Boolean.match(cancelled, {onFalse: Function.constant('Diverted'), onTrue: Function.constant('Cancelled')})
	}
}

function wordsOf(journey: Journey, current: Step, travel: readonly TravelTime[]) {
	if (current.phase === 'leave' || current.phase === 'airport') {
		return homeWords(current.flight, current.phase === 'leave', travel)
	}
	if (current.phase === 'gate') return gateWords(current.flight, current.index > 0)
	if (current.phase === 'boarding') return boardingWords(current.flight)
	if (current.phase === 'taxiing') return taxiWords(current.flight)
	if (current.phase === 'airborne') return airborneWords(current.flight, Array.get(journey, current.index + 1))
	if (current.phase === 'landed') return landedWords(current.flight)
	return stoppedWords(current.flight, current.phase === 'cancelled')
}

// An old answer says when it was read, so it never reads as the current gate; on the way to the airport a delay leads, after it a tight change.
function problemOf(journey: Journey, current: Step, stale: boolean) {
	if (current.phase === 'landed' || current.phase === 'cancelled' || current.phase === 'diverted') {
		return Option.none<string>()
	}
	const late = Option.filter(delayLine(current.flight), () => current.phase === 'leave' || current.phase === 'airport')
	return pipe(
		current.flight.live,
		Option.filter(() => stale),
		Option.map(live => `Updated ${clockAt(live.checkedAt, current.flight.from.timeZone)}`),
		Option.orElse(() => late),
		Option.orElse(() => changeLine(journey, current.index))
	)
}

function toneOf(current: Step, problem: Option.Option<string>) {
	if (current.phase === 'cancelled' || current.phase === 'diverted') return 'bad'
	if (Option.isSome(problem)) return 'warn'
	return 'plain'
}

// What the day's activity shows at `current`, worded for the widget.
export function activityProps(journey: Journey, current: Step, travel: readonly TravelTime[], stale: boolean) {
	const problem = problemOf(journey, current, stale)
	return ActivityProps.make({
		...wordsOf(journey, current, travel),
		deadline: current.deadline,
		delay: Duration.minutes(delayOf(current.flight)),
		phase: current.phase,
		problem,
		segment: current.segment,
		segmentSince: current.segmentSince,
		segmentUntil: current.segmentUntil,
		since: current.since,
		tone: toneOf(current, problem)
	})
}
