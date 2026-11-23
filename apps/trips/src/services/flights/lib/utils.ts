import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Equal,
	Function,
	Number,
	Option,
	Order,
	Result,
	String,
	Struct,
	pipe
} from 'effect'

import {ActivityProps, Flight} from '#services/flights/schema.ts'
import type {
	FlightList,
	Chip,
	FlightPhase,
	FlightTracking,
	Leg,
	LocalTime,
	Traveller
} from '#services/flights/schema.ts'

const OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/u

// Titles a pass prints after a name, which say nothing about who travels.
const TITLES = ['MR', 'MRS', 'MS', 'MISS', 'MSTR', 'DR']

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

// The ticket or the provider says the flight will not run; alerts, the island and the phone all read this one answer.
export function cancelledOf(flight: Flight) {
	if (flight.status === 'cancelled') return true
	return Option.exists<FlightTracking>(flight.live, live => live.state === 'cancelled')
}

export function labelled(label: string, value: Option.Option<string>) {
	return Option.map(value, found => `${label} ${found}`)
}

export function line(parts: Option.Option<string>[]) {
	return Array.join(Array.getSomes(parts), ' · ')
}

// What the travellers share, such as their seats, each told once: "14C, 14D".
export function travellersLine(flight: Flight, field: (traveller: Traveller) => Option.Option<string>) {
	return pipe(
		flight.travellers,
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

export function arrivalOf(flight: Flight) {
	return pipe(
		flight.live,
		Option.flatMap(live => Option.orElse(live.arrivalActual, () => live.arrivalEstimated)),
		Option.getOrElse(() => flight.arrives)
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

// A code as printed, so "abc123 " and "ABC123" are the same one.
function codeOf(flight: Flight) {
	return Option.map(flight.confirmation, code => pipe(code, String.trim, String.toUpperCase))
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
			pipe(
				DateTime.distance(existing.departs, incoming.departs),
				Duration.abs,
				Duration.isLessThan(Duration.hours(20))
			)) ||
		(Option.exists(codeOf(existing), code => Option.contains(codeOf(incoming), code)) &&
			Equal.equals(existing.to.code, incoming.to.code))
	)
}

// A name as a pass or a booking prints it, so ROSSI/MATTEO MR and Matteo Rossi are one person: its words in any order, without accents or titles.
function nameKey(name: string) {
	return pipe(
		name,
		String.normalize('NFD'),
		String.replaceAll(/[\u0300-\u036F]/gu, ''),
		String.toUpperCase,
		String.split(/[^A-Z]+/u),
		Array.filter(word => String.isNonEmpty(word) && !Array.contains(TITLES, word)),
		Array.sort(String.Order),
		Array.join(' ')
	)
}

// A traveller saved before Trips read names is whoever holds its seat, or anyone while it has none.
function sameTraveller(existing: Traveller, incoming: Traveller) {
	return Option.match(Option.all([existing.name, incoming.name]), {
		onNone: () =>
			Option.isNone(existing.name) && (Option.isNone(existing.seat) || Equal.equals(existing.seat, incoming.seat)),
		onSome: names => nameKey(names[0]) === nameKey(names[1])
	})
}

// Each ticket adds the travellers it names, so passes shared for other people fill one flight; a traveller already on it takes the newer ticket's seat and group.
function travellersOf(existing: readonly Traveller[], incoming: readonly Traveller[]) {
	return Array.mapAccum(incoming, existing, (travellers, traveller) =>
		pipe(
			travellers,
			Array.findFirst(held => sameTraveller(held, traveller)),
			Option.match({
				onNone: () => [[...travellers, traveller], undefined] as const,
				onSome: found =>
					[
						Array.map(travellers, held =>
							Boolean.match(held === found, {
								onFalse: () => held,
								onTrue: () => ({
									boardingGroup: newer(held.boardingGroup, traveller.boardingGroup),
									name: newer(held.name, traveller.name),
									seat: newer(held.seat, traveller.seat)
								})
							})
						),
						undefined
					] as const
			})
		)
	)[0]
}

// The newer ticket wins field by field, except the confirmation, where the first code saved stays since another traveller's pass prints their own; the id stays, and live data survives only while it describes the same service.
function combine(existing: Flight, incoming: Flight) {
	const same =
		existing.airlineCode === incoming.airlineCode &&
		existing.number === incoming.number &&
		pipe(DateTime.distance(incoming.departs, existing.departs), Duration.abs, Duration.isLessThanOrEqualTo(HOUR))
	return Flight.make({
		...Struct.pick(incoming, Struct.keys(Flight.fields)),
		boardingAt: newer(existing.boardingAt, incoming.boardingAt),
		confirmation: Option.orElse(existing.confirmation, () => incoming.confirmation),
		id: existing.id,
		live: Option.filter(existing.live, () => same),
		travellers: travellersOf(existing.travellers, incoming.travellers)
	})
}

export function upsert(current: FlightList, incoming: FlightList) {
	return Array.mapAccum(incoming, current, (flights, flight) =>
		pipe(
			flights,
			Array.findFirst(existing => sameFlight(existing, flight)),
			Option.match({
				onNone: () => [[...flights, flight], undefined] as const,
				onSome: existing => {
					const merged = combine(existing, flight)
					return [
						Array.map(flights, item => Boolean.match(item === existing, {onFalse: () => item, onTrue: () => merged})),
						undefined
					] as const
				}
			})
		)
	)[0]
}

// A flight's activity opens three hours ahead.
function autoStartOf(flight: Flight) {
	return DateTime.subtractDuration(flight.departs, Duration.hours(3))
}

type ActivityWindow = {end: DateTime.Utc; leg: Leg; start: DateTime.Utc}

// A flight longer than ActivityKit's eight hours, delays included, gets a second activity for its arrival.
function activityWindows(flight: Flight, requested: Option.Option<DateTime.Utc>) {
	const start = Option.match(requested, {
		onNone: () => autoStartOf(flight),
		onSome: at => DateTime.min(at, autoStartOf(flight))
	})
	// A cancellation the provider reported stays on the island for an hour from when it was read, then the activity ends.
	const landed = DateTime.addDuration(arrivalOf(flight), Duration.minutes(45))
	const end = pipe(
		flight.live,
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
		departureOf(flight),
		DateTime.addDuration(Duration.minutes(45)),
		DateTime.min(DateTime.addDuration(start, ACTIVITY_LIFETIME))
	)
	return [
		{end: departed, leg: 'departure', start},
		{end, leg: 'arrival', start: DateTime.max(departed, DateTime.subtractDuration(end, ACTIVITY_LIFETIME))}
	] satisfies ActivityWindow[]
}

export function activeWindow(
	flight: Flight,
	now: DateTime.Utc,
	requested: Option.Option<DateTime.Utc> = Option.none()
) {
	return Array.findFirst(
		activityWindows(flight, requested),
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
	if (phase === 'landed') return `Landed in ${Option.getOrElse(flight.to.city, () => flight.to.name)}`
	if (phase === 'diverted') return 'Diverted'
	return 'Cancelled'
}

// An old answer stays on the island, plain and dated, so it never reads as the current gate.
function staleNote(live: Option.Option<FlightTracking>, timeZone: string, stale: boolean) {
	return Option.flatMap(live, found =>
		Option.liftPredicate(`Updated ${clockAt(found.checkedAt, timeZone)}`, () => stale)
	)
}

function flightDetail(flight: Flight, phase: FlightPhase, stale: boolean) {
	if (phase === 'landed') return ''
	return line([
		labelled(
			'Group',
			travellersLine(flight, traveller => traveller.boardingGroup)
		),
		labelled(
			'was',
			Option.flatMap(flight.live, live => live.previousGate)
		),
		staleNote(flight.live, flight.from.timeZone, stale)
	])
}

function flightChip(flight: Flight, phase: FlightPhase, stale: boolean) {
	if (phase === 'landed') return Option.none<Chip>()
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
		Option.map(
			text =>
				({
					text,
					tone: Boolean.match(stale, {onFalse: Function.constant('warn'), onTrue: Function.constant('plain')})
				}) satisfies Chip
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

export function activityProps(flight: Flight, now: DateTime.Utc, stale: boolean) {
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
		detail: flightDetail(flight, phase, stale),
		from: Option.getOrElse(flight.from.code, () => flight.from.name),
		headline: flightHeadline(flight, phase),
		label: flightLabel(phase),
		note: line([
			labelled(
				'Seat',
				travellersLine(flight, traveller => traveller.seat)
			)
		]),
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
