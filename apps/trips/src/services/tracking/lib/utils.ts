import {Array, DateTime, Number, Option, Order, Predicate, Record, Result, String, pipe} from 'effect'

import {AIRPORT_LEAD, arrivalOf, departureOf, HOUR, MINUTE} from '#services/bookings/lib/utils.ts'
import type {Booking, Flight, FlightTracking, Place, Train, TrainTracking} from '#services/bookings/schema.ts'
import type {FaFlight, FaFlights, VtStatus, VtStop} from '#services/tracking/schema.ts'

function instant(value?: string | null) {
	return pipe(Option.fromNullishOr(value), Option.flatMap(DateTime.make), Option.map(DateTime.toEpochMillis))
}

function text(value?: string | null) {
	return pipe(Option.fromNullishOr(value), pipelineSubject618 => Option.map(pipelineSubject618, String.trim), pipelineSubject604 => Option.filter(pipelineSubject604, String.isNonEmpty))
}

// The operation that leaves the booked airport closest to the booked time; a codeshare or a schedule change keeps the same one.
export function pickFlight(flights: FaFlights['flights'], flight: Flight) {
	return pipe(
		Array.filter(
			flights,
			candidate =>
				Option.exists(flight.live, live => candidate.fa_flight_id === live.providerId) ||
				Option.exists(Option.fromNullishOr(candidate.origin?.code_iata), code => code === flight.from.code)
		),
		Array.filterMap(candidate =>
			pipe(instant(candidate.scheduled_out), Option.map(out => Math.abs(out - flight.departs)), Option.filter(gap => gap < 12 * HOUR), pipelineSubject1186 => Option.match(pipelineSubject1186, {onNone: () => Result.failVoid, onSome: gap => Result.succeed({candidate, gap})}))
		),
		matches => {
			if (Array.isReadonlyArrayNonEmpty(matches)) {
				return Option.some(
					Array.min(
						matches,
						Order.mapInput(Order.Number, (match: {gap: number}) => match.gap)
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
	if (Option.isSome(instant(answer.actual_in))) return 'arrived'
	if (Option.isSome(instant(answer.actual_on))) return 'landed'
	if (Option.isSome(instant(answer.actual_off))) return 'airborne'
	if (Option.isSome(instant(answer.actual_out))) return 'departed'
	return 'scheduled'
}

export function flightTracking(answer: FaFlight, checkedAt: number, last: Option.Option<FlightTracking>) {
	const previous = Option.getOrUndefined(last)
	const gate = text(answer.gate_origin)
	const tracking: FlightTracking = {
		...Record.getSomes({
			aircraft: text(answer.aircraft_type),
			arrivalGate: text(answer.gate_destination),
			arrivalTerminal: text(answer.terminal_destination),
			belt: text(answer.baggage_claim),
			departureGate: gate,
			departureTerminal: text(answer.terminal_origin),
			// A gate that replaces another keeps the old one to show the change; the same gate keeps any earlier change.
			previousGate: Option.flatMap(gate, current =>
				pipe(Option.fromUndefinedOr(previous?.departureGate), Option.filter(before => before !== current), Option.orElse(() => Option.filter(Option.fromUndefinedOr(previous?.previousGate), () => previous?.departureGate === current)))
			),
			providerId: Option.fromNullishOr(answer.fa_flight_id)
		}),
		checkedAt,
		...Record.getSomes({
			arrivalActual: instant(answer.actual_in),
			arrivalEstimated: instant(answer.estimated_in),
			departureActual: instant(answer.actual_out),
			departureEstimated: instant(answer.estimated_out),
			takeoffActual: instant(answer.actual_off)
		}),
		state: flightState(answer)
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

function stopFor(stops: VtStatus['fermate'], place: Place) {
	return pipe(String.match(/it-trenitalia_(\d+)/u)(place.code ?? ''), Option.flatMap(match =>
			Array.findFirst(stops, stop => stop.id === `S${match[1] ?? ''}`)), Option.orElse(() => Array.findFirst(stops, stop => normalized(stop.stazione) === normalized(place.name))))
}

function left(stop: VtStop) {
	return Predicate.isNotNullish(stop.partenzaReale)
}

function trainState(from: Option.Option<VtStop>, to: Option.Option<VtStop>) {
	if (Option.exists(to, stop => stop.actualFermataType === 1)) return 'arrived'
	if (Option.exists(from, left)) return 'departed'
	return 'scheduled'
}

// Only the run that calls at the booked station near the booked time; another day's run of a daily number, or an unplaced station, answers none.
export function trainTracking(answer: VtStatus, train: Train, checkedAt: number) {
	const from = stopFor(answer.fermate, train.from)
	const to = stopFor(answer.fermate, train.to)
	if (
		!Option.exists(from, stop =>
			Option.exists(Option.fromNullishOr(stop.programmata), planned => Math.abs(planned - train.departs) <= 3 * HOUR)
		)
	) {
		return Option.none<TrainTracking>()
	}
	const tracking: TrainTracking = {
		...Record.getSomes({
			arrivalPlatform: Option.flatMap(to, stop =>
				Option.orElse(text(stop.binarioEffettivoArrivoDescrizione), () =>
					text(stop.binarioProgrammatoArrivoDescrizione)
				)
			),
			departurePlatform: Option.flatMap(from, stop =>
				Option.orElse(text(stop.binarioEffettivoPartenzaDescrizione), () =>
					text(stop.binarioProgrammatoPartenzaDescrizione)
				)
			),
			departurePlatformPlanned: Option.flatMap(from, stop => text(stop.binarioProgrammatoPartenzaDescrizione))
		}),
		checkedAt,
		delayMinutes: pipe(to, Option.filter(stop => stop.actualFermataType === 1), Option.flatMap(stop => Option.fromNullishOr(stop.ritardo)), Option.orElse(() => Option.fromNullishOr(answer.ritardo)), Option.getOrElse(() => 0)),
		...Record.getSomes({
			departureDelay: pipe(from, pipelineSubject6183 => Option.filter(pipelineSubject6183, left), Option.flatMap(stop => Option.fromNullishOr(stop.ritardo)))
		}),
		...Record.getSomes({
			lastSeen: Option.filter(
				Option.all({
					at: Option.fromNullishOr(answer.oraUltimoRilevamento),
					station: text(answer.stazioneUltimoRilevamento)
				}),
				seen => seen.station !== '--'
			)
		}),
		state: trainState(from, to)
	}
	return Option.some(tracking)
}

function flightInterval(flight: Flight, now: number) {
	const departure = departureOf(flight)
	const arrival = arrivalOf(flight)
	const live = Option.getOrUndefined(flight.live)
	const state = live?.state
	if (flight.status === 'cancelled' || state === 'cancelled' || state === 'diverted') return Option.none<number>()
	// FlightAware answers at most two days ahead.
	if (now < flight.departs - 47 * HOUR || now > arrival + 2 * HOUR) return Option.none<number>()
	if (state === 'arrived') {
		if (live?.belt === undefined && now < arrival + 45 * MINUTE) return Option.some(5 * MINUTE)
		return Option.none<number>()
	}
	if (state === 'landed') return Option.some(5 * MINUTE)
	if (state === 'departed' || state === 'airborne') {
		if (now > arrival - 45 * MINUTE) return Option.some(5 * MINUTE)
		return Option.some(15 * MINUTE)
	}
	if (now < departure - 6 * HOUR) return Option.some(3 * HOUR)
	if (now < departure - AIRPORT_LEAD) return Option.some(20 * MINUTE)
	return Option.some(5 * MINUTE)
}

// ViaggiaTreno lists only the day's runs and assigns platforms in the last hour.
function trainInterval(train: Train, now: number) {
	if (
		train.status === 'cancelled' ||
		train.operator !== 'trenitalia' ||
		Option.exists(train.live, live => live.state === 'arrived')
	) {
		return Option.none<number>()
	}
	if (now < train.departs - 6 * HOUR || now > arrivalOf(train) + 30 * MINUTE) return Option.none<number>()
	if (now < train.departs - 90 * MINUTE) return Option.some(30 * MINUTE)
	return Option.some(MINUTE)
}

export function checkEvery(booking: Booking, now: number) {
	if (booking._tag === 'stay') return Option.none<number>()
	if (booking._tag === 'flight') return flightInterval(booking, now)
	return trainInterval(booking, now)
}

// The last attempt counts, answered or not, so a failing provider is asked on the same schedule.
export function isDue(booking: Booking, now: number, attemptedAt: number) {
	if (booking._tag === 'stay') return false
	const checkedAt = Option.match(booking.live, {onNone: () => 0, onSome: live => live.checkedAt})
	return Option.exists(checkEvery(booking, now), every => now - Number.max(checkedAt, attemptedAt) >= every)
}

// Live data that missed two of the checks due after it no longer describes the journey, even once tracking stopped; an arrival is final.
export function isStale(booking: Booking, now: number) {
	if (booking._tag === 'stay') return false
	return pipe(booking.live, Option.filter(live => live.state !== 'arrived'), Option.exists(live => Option.exists(checkEvery(booking, live.checkedAt), every => now - live.checkedAt > 2 * every + 2 * MINUTE)))
}
