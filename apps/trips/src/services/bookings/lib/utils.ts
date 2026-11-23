import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Equal,
	Function,
	HashSet,
	Number,
	Option,
	Order,
	String,
	Struct,
	pipe
} from 'effect'

import {ActivityProps, Booking, Flight, Stay} from '#services/bookings/schema.ts'
import type {BookingList, Chip, FlightPhase, FlightTracking, Leg, LocalTime, Tone} from '#services/bookings/schema.ts'

const OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/u

export const MINUTE = Duration.minutes(1)
export const HOUR = Duration.hours(1)

export const AIRPORT_LEAD = Duration.hours(2)

// ActivityKit ends a Live Activity after eight hours; half an hour stays in reserve for delays.
export const ACTIVITY_LIFETIME = Duration.hours(7.5)

export const ACTIVITY_NAME = 'JourneyActivity'

function zonedOf(time: LocalTime, timeZone: Option.Option<string>) {
	if (Option.isSome(String.match(OFFSET)(time))) {
		return DateTime.makeZonedFromString(String.replace(/Z$/u, '+00:00')(time))
	}
	// The wall-clock parts, read in the place's zone without dropping seconds or fractions.
	return Option.flatMap(timeZone, zone => DateTime.makeZoned(time, {adjustForTimeZone: true, timeZone: zone}))
}

// A time with an offset or Z stands for itself; a wall time the place never shows, such as 30 February or 02:30 as summer time begins, reads as nothing rather than as another moment.
export function instantOf(time: LocalTime, timeZone: Option.Option<string>) {
	return pipe(
		zonedOf(time, timeZone),
		Option.filter(at => {
			const parts = DateTime.toParts(at)
			return (
				`${parts.year}${pipe(
					[parts.month, parts.day, parts.hour, parts.minute],
					Array.map(part => String.padStart(2, '0')(`${part}`)),
					Array.join('')
				)}` === String.replaceAll(/\D/gu, '')(String.slice(0, 16)(time))
			)
		}),
		Option.map(DateTime.toUtc)
	)
}

export function clockAt(time: DateTime.Utc, timeZone: string) {
	return DateTime.format(time, {hour: '2-digit', hourCycle: 'h23', locale: 'en-GB', minute: '2-digit', timeZone})
}

// The ticket or the provider says the flight will not run; alerts, the island, the phone and the calendar all read this one answer.
export function cancelledOf(booking: Booking) {
	if (booking.status === 'cancelled') return true
	if (Booking.isAnyOf(['stay'])(booking)) return false
	return Option.exists<FlightTracking>(booking.live, live => live.state === 'cancelled')
}

export function labelled(label: string, value: Option.Option<string>) {
	return Option.map(value, found => `${label} ${found}`)
}

export function line(parts: Option.Option<string>[]) {
	return Array.join(Array.getSomes(parts), ' · ')
}

export function departureOf(booking: Flight) {
	return pipe(
		booking.live,
		Option.flatMap(live => Option.orElse(live.departureActual, () => live.departureEstimated)),
		Option.getOrElse(() => booking.departs)
	)
}

export function arrivalOf(booking: Flight) {
	return pipe(
		booking.live,
		Option.flatMap(live => Option.orElse(live.arrivalActual, () => live.arrivalEstimated)),
		Option.getOrElse(() => booking.arrives)
	)
}

// The local date at a place, as midnight UTC of that date, so dates in different zones compare by the calendar.
function localDate(at: DateTime.Utc, timeZone: string) {
	const parts = DateTime.toParts(DateTime.makeZonedUnsafe(at, {timeZone}))
	return DateTime.makeUnsafe({day: parts.day, month: parts.month, year: parts.year})
}

// The calendar days from one place's local date to another's, as a traveller counts them, whatever the hours between.
export function daysBetween(from: DateTime.Utc, fromZone: string, to: DateTime.Utc, toZone: string) {
	return Number.round(Duration.toDays(DateTime.distance(localDate(from, fromZone), localDate(to, toZone))), 0)
}

// The days a clock lands after or before the day it set out, as boarding passes print it: " +1", " −1" or nothing.
export function dayMark(days: number) {
	if (days === 0) return ''
	if (days > 0) return ` +${days}`
	return ` −${-days}`
}

export function arrivalClockOf(booking: Flight) {
	return `${clockAt(arrivalOf(booking), booking.to.timeZone)}${dayMark(daysBetween(departureOf(booking), booking.from.timeZone, arrivalOf(booking), booking.to.timeZone))}`
}

export function startOf(booking: Booking) {
	if (Booking.isAnyOf(['stay'])(booking)) return booking.checkIn
	return departureOf(booking)
}

export function endOf(booking: Booking) {
	if (Booking.isAnyOf(['stay'])(booking)) return booking.checkOut
	return arrivalOf(booking)
}

export const byStart = Order.mapInput(DateTime.Order, startOf)

export function titleOf(booking: Booking) {
	if (Booking.isAnyOf(['stay'])(booking)) return booking.name
	return `${booking.airlineCode} ${booking.number}`
}

export function routeOf(booking: Booking) {
	if (Booking.isAnyOf(['stay'])(booking)) {
		return pipe(
			booking.place.city,
			Option.orElse(() => booking.place.address),
			Option.getOrElse(() => booking.name)
		)
	}
	return `${Option.getOrElse(booking.from.city, () => booking.from.name)} → ${Option.getOrElse(booking.to.city, () => booking.to.name)}`
}

function wordsOf(texts: readonly Option.Option<string>[]) {
	return HashSet.fromIterable(
		Array.flatMap(Array.getSomes(texts), text =>
			pipe(
				text,
				String.normalize('NFD'),
				String.replaceAll(/[̀-ͯ]/gu, ''),
				String.toLowerCase,
				String.split(/[^a-z0-9]+/u),
				Array.filter(word => word.length >= 3)
			)
		)
	)
}

// The stay is where the flight ends only when the place names say so: its city among the destination's words, or the destination's city in its address.
function staysAt(stay: Stay, flight: Flight) {
	if (stay.place.timeZone !== flight.to.timeZone) return false
	const destination = wordsOf([flight.to.city, Option.some(flight.to.name)])
	const address = wordsOf([stay.place.city, stay.place.address])
	const city = wordsOf([stay.place.city])
	const arrivalCity = wordsOf([flight.to.city])
	return (
		(HashSet.size(city) > 0 && HashSet.isSubset(city, destination)) ||
		(HashSet.size(arrivalCity) > 0 && HashSet.isSubset(arrivalCity, address))
	)
}

export function stayAfter(bookings: BookingList, flight: Flight) {
	const arrival = arrivalOf(flight)
	const stays = Array.filter(
		bookings,
		(booking): booking is Stay =>
			Booking.isAnyOf(['stay'])(booking) &&
			booking.status === 'confirmed' &&
			staysAt(booking, flight) &&
			DateTime.isGreaterThan(booking.checkIn, DateTime.subtractDuration(arrival, Duration.hours(12))) &&
			DateTime.isLessThan(booking.checkIn, DateTime.addDuration(arrival, Duration.hours(36))) &&
			DateTime.isGreaterThan(booking.checkOut, arrival)
	)
	if (Array.isReadonlyArrayNonEmpty(stays)) return Option.some(Array.min(stays, byStart))
	return Option.none<Stay>()
}

function near(left: DateTime.Utc, right: DateTime.Utc) {
	return pipe(DateTime.distance(left, right), Duration.abs, Duration.isLessThan(Duration.hours(20)))
}

// A code as printed, so "abc123 " and "ABC123" are the same one.
function codeOf(booking: Booking) {
	return Option.map(booking.confirmation, code => pipe(code, String.trim, String.toUpperCase))
}

function sameConfirmation(left: Booking, right: Booking) {
	return Option.exists(codeOf(left), code => Option.contains(codeOf(right), code))
}

// A field the newer ticket leaves out keeps what the older one printed.
function newer<A>(existing: Option.Option<A>, incoming: Option.Option<A>) {
	return Option.orElse(incoming, () => existing)
}

// The same flight, keyed by origin since BA15 flies two legs a day, or a rebooking under the same confirmation and route.
function sameFlight(existing: Flight, incoming: Flight) {
	if (!Equal.equals(existing.from.code, incoming.from.code)) return false
	return (
		(existing.airlineCode === incoming.airlineCode &&
			existing.number === incoming.number &&
			near(existing.departs, incoming.departs)) ||
		(sameConfirmation(existing, incoming) && Equal.equals(existing.to.code, incoming.to.code))
	)
}

function sameReservation(existing: Booking, incoming: Booking) {
	// Two codes that both exist and differ are two travellers, never one booking.
	if (Option.exists(codeOf(existing), code => Option.exists(codeOf(incoming), other => other !== code))) return false
	if (Booking.isAnyOf(['flight'])(existing) && Booking.isAnyOf(['flight'])(incoming)) {
		return sameFlight(existing, incoming)
	}
	if (Booking.isAnyOf(['stay'])(existing) && Booking.isAnyOf(['stay'])(incoming)) {
		return (
			sameConfirmation(existing, incoming) ||
			(existing.name === incoming.name && near(existing.checkIn, incoming.checkIn))
		)
	}
	return false
}

function rideFields(existing: Flight, incoming: Flight) {
	return {
		confirmation: newer(existing.confirmation, incoming.confirmation),
		id: existing.id,
		seat: newer(existing.seat, incoming.seat)
	}
}

// The newer ticket wins field by field; the id stays, and live data survives only while it describes the same service.
function combine(existing: Booking, incoming: Booking) {
	if (Booking.isAnyOf(['flight'])(existing) && Booking.isAnyOf(['flight'])(incoming)) {
		const same =
			existing.airlineCode === incoming.airlineCode &&
			existing.number === incoming.number &&
			pipe(DateTime.distance(incoming.departs, existing.departs), Duration.abs, Duration.isLessThanOrEqualTo(HOUR))
		return Flight.make({
			...Struct.pick(incoming, Struct.keys(Flight.fields)),
			...rideFields(existing, incoming),
			boardingAt: newer(existing.boardingAt, incoming.boardingAt),
			boardingGroup: newer(existing.boardingGroup, incoming.boardingGroup),
			live: Option.filter(existing.live, () => same)
		})
	}
	if (Booking.isAnyOf(['stay'])(existing) && Booking.isAnyOf(['stay'])(incoming)) {
		return Stay.make({
			...Struct.pick(incoming, Struct.keys(Stay.fields)),
			confirmation: newer(existing.confirmation, incoming.confirmation),
			id: existing.id
		})
	}
	return incoming
}

export function upsert(current: BookingList, incoming: BookingList) {
	return Array.mapAccum(incoming, current, (bookings, booking) =>
		pipe(
			bookings,
			Array.findFirst(existing => sameReservation(existing, booking)),
			Option.match({
				onNone: () => [[...bookings, booking], undefined] as const,
				onSome: existing => {
					const merged = combine(existing, booking)
					return [
						Array.map(bookings, item => Boolean.match(item === existing, {onFalse: () => item, onTrue: () => merged})),
						undefined
					] as const
				}
			})
		)
	)[0]
}

// A flight's activity opens three hours ahead.
export function autoStartOf(flight: Flight) {
	return DateTime.subtractDuration(flight.departs, Duration.hours(3))
}

type ActivityWindow = {end: DateTime.Utc; leg: Leg; start: DateTime.Utc}

// A flight longer than ActivityKit's eight hours, delays included, gets a second activity for its arrival.
function activityWindows(booking: Booking, requested: Option.Option<DateTime.Utc>) {
	if (Booking.isAnyOf(['stay'])(booking)) return Array.empty<ActivityWindow>()
	const start = Option.match(requested, {
		onNone: () => autoStartOf(booking),
		onSome: at => DateTime.min(at, autoStartOf(booking))
	})
	// A cancellation the provider reported stays on the island for an hour from when it was read, then the activity ends.
	const landed = DateTime.addDuration(arrivalOf(booking), Duration.minutes(45))
	const end = pipe(
		booking.live,
		Option.filter(found => found.state === 'cancelled'),
		Option.match({
			onNone: () => landed,
			onSome: found => pipe(found.checkedAt, DateTime.addDuration(HOUR), DateTime.min(landed))
		})
	)
	if (pipe(start, DateTime.distance(end), Duration.isLessThanOrEqualTo(ACTIVITY_LIFETIME))) {
		return [{end, leg: 'departure', start}] satisfies ActivityWindow[]
	}
	const departed = pipe(
		departureOf(booking),
		DateTime.addDuration(Duration.minutes(45)),
		DateTime.min(DateTime.addDuration(start, ACTIVITY_LIFETIME))
	)
	return [
		{end: departed, leg: 'departure', start},
		{end, leg: 'arrival', start: DateTime.max(departed, DateTime.subtractDuration(end, ACTIVITY_LIFETIME))}
	] satisfies ActivityWindow[]
}

export function activeWindow(
	booking: Booking,
	now: DateTime.Utc,
	requested: Option.Option<DateTime.Utc> = Option.none()
) {
	return Array.findFirst(
		activityWindows(booking, requested),
		window => DateTime.isLessThanOrEqualTo(window.start, now) && DateTime.isLessThan(now, window.end)
	)
}

function flightPhase(flight: Flight, now: DateTime.Utc) {
	const state = Option.map(flight.live, live => live.state)
	if (flight.status === 'cancelled' || Option.contains(state, 'cancelled')) return 'cancelled'
	if (Option.contains(state, 'diverted')) return 'diverted'
	if (Option.contains(state, 'landed') || Option.contains(state, 'arrived')) return 'landed'
	if (Option.contains(state, 'departed') || Option.contains(state, 'airborne')) return 'airborne'
	if (Option.exists(flight.boardingAt, at => DateTime.isGreaterThanOrEqualTo(now, at))) return 'boarding'
	if (DateTime.isGreaterThanOrEqualTo(now, DateTime.subtractDuration(departureOf(flight), Duration.minutes(45)))) {
		return 'gate'
	}
	if (DateTime.isGreaterThanOrEqualTo(now, DateTime.subtractDuration(departureOf(flight), AIRPORT_LEAD))) {
		return 'airport'
	}
	return 'leave'
}

function flightTarget(flight: Flight, phase: FlightPhase) {
	if (phase === 'leave') return DateTime.subtractDuration(departureOf(flight), AIRPORT_LEAD)
	if (phase === 'airport' || phase === 'gate') return Option.getOrElse(flight.boardingAt, () => departureOf(flight))
	if (phase === 'boarding') return departureOf(flight)
	return arrivalOf(flight)
}

function flightHeadline(flight: Flight, phase: FlightPhase) {
	if (phase === 'leave') return `Leave for ${Option.getOrElse(flight.from.code, () => flight.from.name)}`
	if (phase === 'airport') {
		return Option.getOrElse(
			labelled(
				'Terminal',
				Option.flatMap(flight.live, live => live.departureTerminal)
			),
			Function.constant('At the airport')
		)
	}
	if (phase === 'gate') {
		if (Option.isNone(flight.boardingAt)) return 'Departs in'
		return 'Boards in'
	}
	if (phase === 'boarding') return 'Boarding'
	if (phase === 'airborne') return 'Lands in'
	if (phase === 'landed') {
		return Option.getOrElse(
			labelled(
				'Bags on belt',
				Option.flatMap(flight.live, live => live.belt)
			),
			() => `Landed in ${Option.getOrElse(flight.to.city, () => flight.to.name)}`
		)
	}
	if (phase === 'diverted') return 'Diverted'
	return 'Cancelled'
}

// An old answer stays on the island, plain and dated, so it never reads as the current gate.
function staleNote(live: Option.Option<FlightTracking>, timeZone: string, stale: boolean) {
	return Option.flatMap(live, found =>
		Option.liftPredicate(`Updated ${clockAt(found.checkedAt, timeZone)}`, () => stale)
	)
}

function flightDetail(flight: Flight, bookings: BookingList, phase: FlightPhase, stale: boolean) {
	if (phase === 'landed') {
		return pipe(
			stayAfter(bookings, flight),
			Option.map(stay => `Next: ${stay.name}`),
			Option.orElse(() =>
				labelled(
					'Gate',
					Option.flatMap(flight.live, live => live.arrivalGate)
				)
			),
			Option.getOrElse(Function.constant(''))
		)
	}
	return line([
		labelled('Group', flight.boardingGroup),
		labelled(
			'was',
			Option.flatMap(flight.live, live => live.previousGate)
		),
		staleNote(flight.live, flight.from.timeZone, stale)
	])
}

function chipOf(text: string, tone: Tone) {
	return {text, tone} satisfies Chip
}

function flightChip(flight: Flight, phase: FlightPhase, stale: boolean) {
	if (phase === 'landed') {
		return Option.map(
			labelled(
				'Belt',
				Option.flatMap(flight.live, live => live.belt)
			),
			text => chipOf(text, 'plain')
		)
	}
	return pipe(
		flight.live,
		Option.flatMap(live => live.departureGate),
		Option.orElse(() =>
			pipe(
				flight.live,
				Option.flatMap(live => live.departureTerminal),
				Option.map(terminal => `T${terminal}`)
			)
		),
		Option.map(text =>
			chipOf(text, Boolean.match(stale, {onFalse: Function.constant('warn'), onTrue: Function.constant('plain')}))
		)
	)
}

function flightTone(phase: FlightPhase, late: boolean) {
	if (phase === 'cancelled' || phase === 'diverted') return 'bad'
	if (phase === 'airborne') return 'info'
	if (phase === 'leave' || late) return 'warn'
	return 'good'
}

function flightLabel(phase: FlightPhase) {
	if (phase === 'landed') return 'Landed'
	if (phase === 'diverted') return 'Diverted'
	if (phase === 'cancelled') return 'Cancelled'
	return 'Now'
}

function flightSymbol(phase: FlightPhase) {
	if (phase === 'leave') return 'car.fill'
	if (phase === 'landed') return 'airplane.arrival'
	if (phase === 'cancelled' || phase === 'diverted') return 'exclamationmark.triangle.fill'
	if (phase === 'airborne') return 'airplane'
	return 'airplane.departure'
}

function departureNote(phase: FlightPhase, delay: number) {
	if (phase === 'airborne' || phase === 'landed') return 'Departed'
	if (delay >= 5) return `${delay}m late`
	return 'On time'
}

export function activityProps(flight: Flight, bookings: BookingList, now: DateTime.Utc, stale: boolean) {
	const phase = flightPhase(flight, now)
	const delay = Number.round(Duration.toMinutes(DateTime.distance(flight.departs, departureOf(flight))), 0)
	return ActivityProps.make({
		arrivalNote: Option.getOrElse(flight.to.city, () => flight.to.name),
		arrivalTime: arrivalClockOf(flight),
		arrivalTone: 'plain',
		arrives: arrivalOf(flight),
		chip: flightChip(flight, phase, stale),
		countdown: Option.liftPredicate(
			flightTarget(flight, phase),
			at => phase !== 'landed' && phase !== 'cancelled' && phase !== 'diverted' && DateTime.isGreaterThan(at, now)
		),
		delay: Duration.minutes(delay),
		departureNote: departureNote(phase, delay),
		departureTime: clockAt(departureOf(flight), flight.from.timeZone),
		departureTone: Boolean.match(delay >= 5, {onFalse: Function.constant('plain'), onTrue: Function.constant('warn')}),
		detail: flightDetail(flight, bookings, phase, stale),
		from: Option.getOrElse(flight.from.code, () => flight.from.name),
		headline: flightHeadline(flight, phase),
		label: flightLabel(phase),
		note: line([labelled('Seat', flight.seat)]),
		phase,
		progressFrom: pipe(
			flight.live,
			Option.flatMap(live => live.takeoffActual),
			Option.filter(() => phase === 'airborne')
		),
		symbol: flightSymbol(phase),
		title: titleOf(flight),
		to: Option.getOrElse(flight.to.code, () => flight.to.name),
		tone: flightTone(phase, delay >= 5)
	})
}

export function urgencyOf(props: ActivityProps) {
	return `${props.phase}|${Option.match(props.chip, {onNone: Function.constant(''), onSome: chip => chip.text})}|${Number.round(Duration.toMinutes(props.delay) / 5, 0)}`
}

// Landed counts as arrived on the phone, the island and the server alike.
function arrived(flight: Flight, now: DateTime.Utc) {
	if (DateTime.isGreaterThanOrEqualTo(now, arrivalOf(flight))) return true
	return Option.exists(flight.live, live => live.state === 'arrived' || live.state === 'landed')
}

// A cancelled or landed flight starts no Live Activity, however it is asked for.
export function startable(flight: Flight, now: DateTime.Utc) {
	return (
		!cancelledOf(flight) &&
		!arrived(flight, now) &&
		DateTime.isGreaterThanOrEqualTo(now, DateTime.subtractDuration(flight.departs, Duration.hours(7)))
	)
}
