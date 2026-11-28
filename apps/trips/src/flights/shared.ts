import {Array, DateTime, Duration, Equal, Number, Option, Order, Result, Schema, String, pipe} from 'effect'

import type {Flight, FlightList, FlightTracking, Place, Traveller, TravelTime} from './contract.ts'

import type {FlightPhase, Segment} from '#activities/contract.ts'

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

export function directionsTo(place: Place) {
	const destination = Option.match(Option.all({latitude: place.latitude, longitude: place.longitude}), {
		onNone: () => place.name,
		onSome: coordinates => `${coordinates.latitude},${coordinates.longitude}`
	})
	return `https://maps.apple.com/?${new URLSearchParams({daddr: destination})}`
}

type Drop = typeof Drop.Type
const Drop = Schema.fromJsonString(
	Schema.Struct({addressLine1: Schema.String, latitude: Schema.Finite, longitude: Schema.Finite})
)

// Uber’s web ride link avoids the App Store on phones without the app.
export function rideTo(place: Place) {
	return Option.map(
		Option.all({latitude: place.latitude, longitude: place.longitude}),
		coordinates =>
			`https://m.uber.com/looking?${new URLSearchParams({'drop[0]': Schema.encodeSync(Drop)({addressLine1: place.name, ...coordinates})})}`
	)
}

// The trips offered for the way to an airport, in minutes.
export const TRAVEL_CHOICES = [30, 35, 45, 60, 90, 120, 150, 180]

export function travelLabel(minutes: number) {
	const hours = Math.floor(minutes / 60)
	const rest = Number.remainder(minutes, 60)
	if (hours === 0) return `${rest} min`
	if (rest === 0) return `${hours} h`
	return `${hours} h ${rest} min`
}
