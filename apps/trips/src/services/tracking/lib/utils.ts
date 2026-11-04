import {Array, DateTime, Option, Order, Predicate, Record, Result, String, pipe} from 'effect'

import {HOUR} from '#services/bookings/lib/utils.ts'
import type {Flight, FlightTracking, Place, Train, TrainTracking} from '#services/bookings/schema.ts'
import type {FaFlight, FaFlights, VtStatus, VtStop} from '#services/tracking/schema.ts'

function instant(value?: string | null) {
	return pipe(Option.fromNullishOr(value), Option.flatMap(DateTime.make), Option.map(DateTime.toEpochMillis))
}

function text(value?: string | null) {
	return Option.filter(Option.map(Option.fromNullishOr(value), String.trim), String.isNonEmpty)
}

// The operation that leaves the booked airport closest to the booked time; a codeshare or a schedule change keeps the same one.
export function pickFlight(flights: FaFlights['flights'], flight: Flight) {
	return pipe(
		Array.filter(
			flights,
			candidate =>
				candidate.fa_flight_id === flight.live?.providerId ||
				Option.exists(Option.fromNullishOr(candidate.origin?.code_iata), code => code === flight.from.code)
		),
		Array.filterMap(candidate =>
			Option.match(
				Option.filter(
					Option.map(instant(candidate.scheduled_out), out => Math.abs(out - flight.departs)),
					gap => gap < 12 * HOUR
				),
				{onNone: () => Result.failVoid, onSome: gap => Result.succeed({candidate, gap})}
			)
		),
		Array.sort(Order.mapInput(Order.Number, (match: {gap: number}) => match.gap)),
		Array.head,
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

export function flightTracking(answer: FaFlight, checkedAt: number, previous?: FlightTracking) {
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
				Option.orElse(
					Option.filter(Option.fromUndefinedOr(previous?.departureGate), before => before !== current),
					() => Option.filter(Option.fromUndefinedOr(previous?.previousGate), () => previous?.departureGate === current)
				)
			),
			providerId: Option.fromNullishOr(answer.fa_flight_id)
		}),
		checkedAt,
		...Record.getSomes({
			arrivalActual: instant(answer.actual_in),
			arrivalEstimated: instant(answer.estimated_in),
			departureActual: instant(answer.actual_out),
			departureEstimated: instant(answer.estimated_out),
			landingActual: instant(answer.actual_on),
			progress: Option.fromNullishOr(answer.progress_percent),
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

// The run's stop for a booked station: by station code, else by name.
function stopFor(stops: VtStatus['fermate'], place: Place) {
	return Option.orElse(
		// "S08409" from Transitous' "it-trenitalia_08409:station", which ViaggiaTreno uses as its stop id.
		Option.flatMap(String.match(/it-trenitalia_(\d+)/u)(place.code ?? ''), match =>
			Array.findFirst(stops, stop => stop.id === `S${match[1] ?? ''}`)
		),
		() => Array.findFirst(stops, stop => normalized(stop.stazione) === normalized(place.name))
	)
}

function left(stop: VtStop) {
	return Predicate.isNotNullish(stop.partenzaReale)
}

// Where the passenger stands: a train already running elsewhere is still to board at a later station.
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
		// The delay it arrived with, else the train's running delay.
		delayMinutes: Option.getOrElse(
			Option.orElse(
				Option.flatMap(
					Option.filter(to, stop => stop.actualFermataType === 1),
					stop => Option.fromNullishOr(stop.ritardo)
				),
				() => Option.fromNullishOr(answer.ritardo)
			),
			() => 0
		),
		...Record.getSomes({
			departureDelay: Option.flatMap(Option.filter(from, left), stop => Option.fromNullishOr(stop.ritardo))
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
