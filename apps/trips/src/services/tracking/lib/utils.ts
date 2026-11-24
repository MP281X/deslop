import {Array, DateTime, Duration, Function, Option, Order, Result, String, pipe} from 'effect'

import {AIRPORT_LEAD, arrivalOf, cancelledOf, departureOf} from '#services/flights/lib/utils.ts'
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

export function flightTracking(answer: FaFlight, checkedAt: DateTime.Utc, last: Option.Option<FlightTracking>) {
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

export function checkEvery(flight: Flight, now: DateTime.Utc) {
	const departure = departureOf(flight)
	const arrival = arrivalOf(flight)
	const state = Option.map(flight.live, live => live.state)
	// A flight at its gate has nothing left to report.
	if (cancelledOf(flight) || Option.contains(state, 'diverted') || Option.contains(state, 'arrived')) {
		return Option.none<Duration.Duration>()
	}
	// FlightAware answers at most two days ahead.
	if (
		DateTime.isLessThan(now, DateTime.subtractDuration(flight.departs, Duration.hours(47))) ||
		DateTime.isGreaterThan(now, DateTime.addDuration(arrival, Duration.hours(2)))
	) {
		return Option.none<Duration.Duration>()
	}
	if (Option.contains(state, 'landed')) return Option.some(Duration.minutes(5))
	if (Option.contains(state, 'departed') || Option.contains(state, 'airborne')) {
		if (DateTime.isGreaterThan(now, DateTime.subtractDuration(arrival, Duration.minutes(45)))) {
			return Option.some(Duration.minutes(5))
		}
		return Option.some(Duration.minutes(15))
	}
	if (DateTime.isLessThan(now, DateTime.subtractDuration(departure, Duration.hours(6)))) {
		return Option.some(Duration.hours(3))
	}
	if (DateTime.isLessThan(now, DateTime.subtractDuration(departure, AIRPORT_LEAD))) {
		return Option.some(Duration.minutes(20))
	}
	return Option.some(Duration.minutes(5))
}

// The last attempt counts, answered or not, so a failing provider is asked on the same schedule.
export function isDue(flight: Flight, now: DateTime.Utc, attemptedAt: Option.Option<DateTime.Utc>) {
	const checkedAt = Option.match<FlightTracking, Option.Option<DateTime.Utc>>(flight.live, {
		onNone: () => attemptedAt,
		onSome: live =>
			Option.some(
				Option.match(attemptedAt, {
					onNone: () => live.checkedAt,
					onSome: attempted => DateTime.max(live.checkedAt, attempted)
				})
			)
	})
	return Option.exists(checkEvery(flight, now), every =>
		Option.match(checkedAt, {
			onNone: Function.constTrue,
			onSome: at => pipe(at, DateTime.distance(now), Duration.isGreaterThanOrEqualTo(every))
		})
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
