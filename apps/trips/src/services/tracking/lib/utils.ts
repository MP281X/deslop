import {Array, DateTime, Duration, Function, Number, Option, Order, Result, String, pipe} from 'effect'

import {arrivalOf, cancelledOf, departureOf} from '#services/flights/lib/utils.ts'
import type {Flight, FlightTracking} from '#services/flights/schema.ts'
import type {FaFlight, FaFlights} from '#services/tracking/schema.ts'

function text(value: Option.Option<string>) {
	return pipe(value, Option.map(String.trim), Option.filter(String.isNonEmpty))
}

function nearest(matches: readonly FaFlight[], flight: Flight) {
	return pipe(
		matches,
		Array.filterMap(candidate =>
			pipe(
				candidate.scheduled_out,
				Option.map(out => Duration.abs(DateTime.distance(out, flight.departs))),
				Option.filter(gap => Duration.isLessThan(gap, Duration.hours(12))),
				Option.match({onNone: () => Result.failVoid, onSome: gap => Result.succeed({candidate, gap})})
			)
		),
		Array.match({
			onEmpty: () => Option.none<FaFlight>(),
			onNonEmpty: found =>
				Option.some(
					Array.min(
						found,
						Order.mapInput(Duration.Order, (match: {gap: Duration.Duration}) => match.gap)
					).candidate
				)
		})
	)
}

// The operation saved before while it is still near the booked time, so a codeshare or a schedule change keeps the same one; else the one that leaves the booked airport closest to the booked time.
export function pickFlight(flights: FaFlights['flights'], flight: Flight) {
	return Option.orElse(
		nearest(
			Array.filter(flights, candidate =>
				Option.exists(flight.live, live => Option.contains(live.providerId, candidate.fa_flight_id))
			),
			flight
		),
		() =>
			nearest(
				Array.filter(flights, candidate =>
					pipe(
						candidate.origin,
						Option.flatMap(origin => origin.code_iata),
						Option.exists(code => Option.contains(flight.from.code, code))
					)
				),
				flight
			)
	)
}

// FlightAware is asked for the airline's number around the booked departure, so every ticket of one flight shares that answer and picks its own operation from it.
export function sameLookup(flight: Flight, other: Flight) {
	return (
		flight.airlineCode === other.airlineCode &&
		flight.number === other.number &&
		DateTime.Equivalence(flight.departs, other.departs)
	)
}

function flightState(answer: FaFlight) {
	if (answer.cancelled) return 'cancelled'
	if (answer.diverted) return 'diverted'
	if (Option.isSome(answer.actual_in)) return 'arrived'
	if (Option.isSome(answer.actual_on)) return 'landed'
	if (Option.isSome(answer.actual_off)) return 'airborne'
	if (Option.isSome(answer.actual_out)) return 'departed'
	return 'scheduled'
}

// How late an operation lands against its schedule, to the minute.
export function lateness(answer: FaFlight) {
	return Option.map(
		Option.all({lands: Option.orElse(answer.actual_in, () => answer.estimated_in), scheduled: answer.scheduled_in}),
		times => Duration.minutes(Number.round(Duration.toMinutes(DateTime.distance(times.scheduled, times.lands)), 0))
	)
}

// The plane flying in is asked about only while this flight is still on the ground fifteen minutes or more behind its booked time, since only a delay needs its cause.
export function inboundOf(answer: FaFlight, flight: Flight) {
	return Option.filter(
		answer.inbound_fa_flight_id,
		() =>
			flightState(answer) === 'scheduled' &&
			Option.exists(answer.estimated_out, out =>
				pipe(flight.departs, DateTime.distance(out), Duration.isGreaterThanOrEqualTo(Duration.minutes(15)))
			)
	)
}

export function flightTracking(
	answer: FaFlight,
	checkedAt: DateTime.Utc,
	last: Option.Option<FlightTracking>,
	inboundDelay: Option.Option<Duration.Duration> = Option.none()
) {
	const gate = text(answer.gate_origin)
	const tracking: FlightTracking = {
		aircraft: text(answer.aircraft_type),
		arrivalActual: answer.actual_in,
		arrivalEstimated: answer.estimated_in,
		checkedAt,
		departureActual: answer.actual_out,
		departureEstimated: answer.estimated_out,
		departureGate: gate,
		departureTerminal: text(answer.terminal_origin),
		inboundDelay,
		previousGate: Option.flatMap(gate, current =>
			pipe(
				Option.flatMap(last, previous => previous.departureGate),
				Option.filter(before => before !== current),
				Option.orElse(() =>
					pipe(
						last,
						Option.flatMap(previous => previous.previousGate),
						Option.filter(() => Option.exists(last, previous => Option.contains(previous.departureGate, current)))
					)
				)
			)
		),
		providerId: Option.some(answer.fa_flight_id),
		state: flightState(answer),
		takeoffActual: answer.actual_off
	}
	return tracking
}

// FlightAware searches at most two days ahead, so a lookup asks up to 47 hours on; tracking starts an hour inside that, so the first lookup reaches an hour past the booked departure, which a schedule moved a little later still falls in.
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

// Whether `wait` passed since the later of the saved report and the last attempt: an attempt counts answered or not, so a failing provider is asked on the same schedule, and the report counts after a restart, which forgets the attempts.
function waited(flight: Flight, now: DateTime.Utc, attemptedAt: Option.Option<DateTime.Utc>, wait: Duration.Duration) {
	return Array.match(Array.getSomes([Option.map(flight.live, live => live.checkedAt), attemptedAt]), {
		onEmpty: Function.constTrue,
		onNonEmpty: times =>
			pipe(Array.max(times, DateTime.Order), DateTime.distance(now), Duration.isGreaterThanOrEqualTo(wait))
	})
}

export function isDue(flight: Flight, now: DateTime.Utc, attemptedAt: Option.Option<DateTime.Utc>) {
	return Option.exists(checkEvery(flight, now), every => waited(flight, now, attemptedAt, every))
}

// A pull to refresh asks at most twice as often as the schedule, and never sooner than two minutes after the last check, so it cannot drain FlightAware's allowance.
export function canRefresh(flight: Flight, now: DateTime.Utc, attemptedAt: Option.Option<DateTime.Utc>) {
	return Option.exists(checkEvery(flight, now), every =>
		waited(flight, now, attemptedAt, pipe(every, Duration.divideUnsafe(2), Duration.max(Duration.minutes(2))))
	)
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
