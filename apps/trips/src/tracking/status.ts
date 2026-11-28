import {Array, DateTime, Duration, Function, Number, Option, Order, Result, String, pipe} from 'effect'

import type {FaFlight, FaFlights} from './contract.ts'

import type {Flight, FlightTracking} from '#flights/contract.ts'
import {checkEvery} from '#flights/shared.ts'

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
