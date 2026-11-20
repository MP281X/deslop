import {Array, Boolean, DateTime, Duration, Function, Option, Order, Result, String, pipe} from 'effect'

import {AIRPORT_LEAD, arrivalOf, departureOf, MINUTE} from '#services/bookings/lib/utils.ts'
import {Booking} from '#services/bookings/schema.ts'
import type {Flight, FlightTracking, Train, TrainTracking} from '#services/bookings/schema.ts'
import type {FaFlight, FaFlights, StopPlace, VtStatus, VtStop} from '#services/tracking/schema.ts'

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
		arrivalGate: text(answer.gate_destination),
		arrivalTerminal: text(answer.terminal_destination),
		belt: text(answer.baggage_claim),
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

// ViaggiaTreno abbreviates: "BOLOGNA C.LE/AV" is the ticket's "Bologna Centrale", "FIRENZE S.M.N." its "Firenze Santa Maria Novella".
function normalized(name: string) {
	return pipe(
		name,
		String.normalize('NFD'),
		String.replaceAll(/[̀-ͯ]/gu, ''),
		String.toUpperCase,
		String.replaceAll(/\/AV\b/gu, ''),
		String.replaceAll(/\bC\.LE\b/gu, 'CENTRALE'),
		String.replaceAll(/\bP\.TA\b/gu, 'PORTA'),
		String.replaceAll(/\bS\.\s*M\.\s*N\.?/gu, 'SANTA MARIA NOVELLA'),
		String.replaceAll(/\bS(?:\.|TA)\s+/gu, 'SANTA '),
		String.replaceAll(/[^A-Z0-9]+/gu, ' '),
		String.trim
	)
}

function stopOf(stops: VtStatus['fermate'], place: StopPlace) {
	return pipe(
		place.code,
		Option.flatMap(String.match(/it-trenitalia_(\d+)/u)),
		Option.flatMap(match => Array.findFirst(stops, stop => stop.id === `S${match[1] ?? ''}`)),
		Option.orElse(() => Array.findFirst(stops, stop => normalized(stop.stazione) === normalized(place.name)))
	)
}

function left(stop: VtStop) {
	return Option.isSome(stop.partenzaReale)
}

function trainState(from: Option.Option<VtStop>, to: Option.Option<VtStop>) {
	if (Option.exists(to, stop => Option.contains(stop.actualFermataType, 1))) return 'arrived'
	if (Option.exists(from, left)) return 'departed'
	return 'scheduled'
}

// The caller selects today's run of the number. A report must call at the booked station near its departure time; a full cancellation lists no stops, so it counts only for a train the timetable placed on Trenitalia's own stations, whose numbers ViaggiaTreno names, and otherwise stays unknown.
export function trainTracking(answer: VtStatus, train: Train, checkedAt: DateTime.Utc) {
	const from = stopOf(answer.fermate, train.from)
	const to = stopOf(answer.fermate, train.to)
	const cancelled =
		answer.tipoTreno === 'ST' &&
		answer.provvedimento === 1 &&
		Array.isReadonlyArrayEmpty(answer.fermate) &&
		Option.exists(train.from.code, code => Option.isSome(String.match(/it-trenitalia_\d+/u)(code)))
	if (
		!cancelled &&
		!Option.exists(from, stop =>
			Option.exists(stop.programmata, planned =>
				Duration.isLessThanOrEqualTo(Duration.abs(DateTime.distance(planned, train.departs)), Duration.hours(3))
			)
		)
	) {
		return Option.none<TrainTracking>()
	}
	const tracking: TrainTracking = {
		arrivalPlatform: Option.flatMap(to, stop =>
			Option.orElse(text(stop.binarioEffettivoArrivoDescrizione), () => text(stop.binarioProgrammatoArrivoDescrizione))
		),
		checkedAt,
		delayMinutes: pipe(
			to,
			Option.filter(stop => Option.contains(stop.actualFermataType, 1)),
			Option.flatMap(stop => stop.ritardo),
			Option.orElse(() => answer.ritardo),
			Option.getOrElse(() => Duration.zero)
		),
		departureDelay: pipe(
			from,
			Option.filter(left),
			Option.flatMap(stop => stop.ritardo)
		),
		departurePlatform: Option.flatMap(from, stop =>
			Option.orElse(text(stop.binarioEffettivoPartenzaDescrizione), () =>
				text(stop.binarioProgrammatoPartenzaDescrizione)
			)
		),
		departurePlatformPlanned: Option.flatMap(from, stop => text(stop.binarioProgrammatoPartenzaDescrizione)),
		lastSeen: Option.filter(
			Option.all({at: answer.oraUltimoRilevamento, station: text(answer.stazioneUltimoRilevamento)}),
			seen => seen.station !== '--'
		),
		state: Boolean.match(
			cancelled ||
				Option.exists(from, stop => Option.contains(stop.actualFermataType, 3)) ||
				Option.exists(to, stop => Option.contains(stop.actualFermataType, 3)),
			{onFalse: () => trainState(from, to), onTrue: Function.constant('cancelled' as const)}
		)
	}
	return Option.some(tracking)
}

function flightInterval(flight: Flight, now: DateTime.Utc) {
	const departure = departureOf(flight)
	const arrival = arrivalOf(flight)
	const state = Option.map(flight.live, live => live.state)
	if (flight.status === 'cancelled' || Option.contains(state, 'cancelled') || Option.contains(state, 'diverted')) {
		return Option.none<Duration.Duration>()
	}
	// FlightAware answers at most two days ahead.
	if (
		DateTime.isLessThan(now, DateTime.subtractDuration(flight.departs, Duration.hours(47))) ||
		DateTime.isGreaterThan(now, DateTime.addDuration(arrival, Duration.hours(2)))
	) {
		return Option.none<Duration.Duration>()
	}
	if (Option.contains(state, 'arrived')) {
		return Option.liftPredicate(
			Duration.minutes(5),
			() =>
				!Option.exists(flight.live, live => Option.isSome(live.belt)) &&
				DateTime.isLessThan(now, DateTime.addDuration(arrival, Duration.minutes(45)))
		)
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

// ViaggiaTreno lists only today's runs and assigns platforms in the last hour: poll from six hours ahead, every minute in the last ninety minutes.
function trainInterval(train: Train, now: DateTime.Utc) {
	if (
		train.status === 'cancelled' ||
		Option.exists(train.live, live => live.state === 'arrived' || live.state === 'cancelled')
	) {
		return Option.none<Duration.Duration>()
	}
	if (
		DateTime.isLessThan(now, DateTime.subtractDuration(train.departs, Duration.hours(6))) ||
		DateTime.isGreaterThan(now, DateTime.addDuration(arrivalOf(train), Duration.minutes(30)))
	) {
		return Option.none<Duration.Duration>()
	}
	if (DateTime.isLessThan(now, DateTime.subtractDuration(train.departs, Duration.minutes(90)))) {
		return Option.some(Duration.minutes(30))
	}
	return Option.some(MINUTE)
}

export function checkEvery(booking: Booking, now: DateTime.Utc) {
	if (Booking.isAnyOf(['stay'])(booking)) return Option.none<Duration.Duration>()
	if (Booking.isAnyOf(['flight'])(booking)) return flightInterval(booking, now)
	return trainInterval(booking, now)
}

// The last attempt counts, answered or not, so a failing provider is asked on the same schedule.
export function isDue(booking: Booking, now: DateTime.Utc, attemptedAt: Option.Option<DateTime.Utc>) {
	if (Booking.isAnyOf(['stay'])(booking)) return false
	const checkedAt = Option.match<FlightTracking | TrainTracking, Option.Option<DateTime.Utc>>(booking.live, {
		onNone: () => attemptedAt,
		onSome: live =>
			Option.some(
				Option.match(attemptedAt, {
					onNone: () => live.checkedAt,
					onSome: attempted => DateTime.max(live.checkedAt, attempted)
				})
			)
	})
	return Option.exists(checkEvery(booking, now), every =>
		Option.match(checkedAt, {
			onNone: Function.constTrue,
			onSome: at => pipe(at, DateTime.distance(now), Duration.isGreaterThanOrEqualTo(every))
		})
	)
}

// Live data that missed two of the checks due after it no longer describes the journey, even once tracking stopped; an arrival is final. Checks come at the shorter of the pace when it was read and the pace now, since the pace quickens near departure.
export function isStale(booking: Booking, now: DateTime.Utc) {
	if (Booking.isAnyOf(['stay'])(booking)) return false
	return Option.exists<FlightTracking | TrainTracking>(
		booking.live,
		live =>
			live.state !== 'arrived' &&
			pipe(
				Array.getSomes([checkEvery(booking, live.checkedAt), checkEvery(booking, now)]),
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
