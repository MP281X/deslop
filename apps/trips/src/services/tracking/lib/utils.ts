import {Array, DateTime, Duration, Function, Option, Order, Result, String, pipe} from 'effect'

import {AIRPORT_LEAD, arrivalOf, departureOf, MINUTE} from '#services/bookings/lib/utils.ts'
import type {Booking, Flight, FlightTracking, Place, Train, TrainTracking} from '#services/bookings/schema.ts'
import type {FaFlight, FaFlights, VtStatus, VtStop} from '#services/tracking/schema.ts'

function text(value: Option.Option<string>) {
	return pipe(value, Option.map(String.trim), Option.filter(String.isNonEmpty))
}

// The operation that leaves the booked airport closest to the booked time; a codeshare or a schedule change keeps the same one.
export function pickFlight(flights: FaFlights['flights'], flight: Flight) {
	return pipe(
		Array.filter(
			flights,
			candidate =>
				Option.exists(flight.live, live => Option.contains(live.providerId, candidate.fa_flight_id)) ||
				pipe(
					candidate.origin,
					Option.flatMap(origin => origin.code_iata),
					Option.exists(code => Option.contains(flight.from.code, code))
				)
		),
		Array.filterMap(candidate =>
			pipe(
				candidate.scheduled_out,
				Option.map(out => Duration.abs(DateTime.distance(out, flight.departs))),
				Option.filter(gap => Duration.isLessThan(gap, Duration.hours(12))),
				Option.match({onNone: () => Result.failVoid, onSome: gap => Result.succeed({candidate, gap})})
			)
		),
		matches => {
			if (Array.isReadonlyArrayNonEmpty(matches)) {
				return Option.some(
					Array.min(
						matches,
						Order.mapInput(Duration.Order, (match: {gap: Duration.Duration}) => match.gap)
					)
				)
			}
			return Option.none()
		},
		Option.map(match => match.candidate)
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

function stopOf(stops: VtStatus['fermate'], place: Pick<Place, 'code' | 'name'>) {
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

// Only the run that calls at the booked station near the booked time; another day's run of a daily number, or an unplaced station, answers none.
export function trainTracking(answer: VtStatus, train: Train, checkedAt: DateTime.Utc) {
	const from = stopOf(answer.fermate, train.from)
	const to = stopOf(answer.fermate, train.to)
	if (
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
		state: trainState(from, to)
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

// ViaggiaTreno lists only the day's runs and assigns platforms in the last hour.
function trainInterval(train: Train, now: DateTime.Utc) {
	if (
		train.status === 'cancelled' ||
		train.operator !== 'trenitalia' ||
		Option.exists(train.live, live => live.state === 'arrived')
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
	if (booking._tag === 'stay') return Option.none<Duration.Duration>()
	if (booking._tag === 'flight') return flightInterval(booking, now)
	return trainInterval(booking, now)
}

// The last attempt counts, answered or not, so a failing provider is asked on the same schedule.
export function isDue(booking: Booking, now: DateTime.Utc, attemptedAt: Option.Option<DateTime.Utc>) {
	if (booking._tag === 'stay') return false
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

// Live data that missed two of the checks due after it no longer describes the journey, even once tracking stopped; an arrival is final.
export function isStale(booking: Booking, now: DateTime.Utc) {
	if (booking._tag === 'stay') return false
	return Option.exists<FlightTracking | TrainTracking>(
		booking.live,
		live =>
			live.state !== 'arrived' &&
			Option.exists(checkEvery(booking, live.checkedAt), every =>
				pipe(
					live.checkedAt,
					DateTime.distance(now),
					Duration.isGreaterThan(pipe(every, Duration.times(2), Duration.sum(Duration.minutes(2))))
				)
			)
	)
}
