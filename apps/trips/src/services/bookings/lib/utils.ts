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
	Result,
	String,
	Struct,
	pipe
} from 'effect'

import {ActivityProps, Booking, Flight, Stay, Train} from '#services/bookings/schema.ts'
import type {
	BookingList,
	Chip,
	FlightPhase,
	FlightTracking,
	Leg,
	LocalTime,
	Tone,
	TrainPhase,
	TrainStop,
	TrainTracking,
	TransitStop
} from '#services/bookings/schema.ts'

const OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/u

const GENERIC = ['bahnhof', 'central', 'centraal', 'centrale', 'gare', 'hauptbahnhof', 'hbf', 'station', 'stazione']

export const MINUTE = Duration.minutes(1)
export const HOUR = Duration.hours(1)

export const AIRPORT_LEAD = Duration.hours(2)
const STATION_LEAD = Duration.minutes(15)

// ActivityKit ends a Live Activity after eight hours; half an hour stays in reserve for delays.
export const ACTIVITY_LIFETIME = Duration.hours(7.5)

export const ACTIVITY_NAME = 'JourneyActivity'

export function stationWords(text: string) {
	return pipe(
		text,
		String.normalize('NFD'),
		String.replaceAll(/[̀-ͯ]/gu, ''),
		String.toLowerCase,
		String.split(/[^a-z0-9]+/u)
	)
}

function significant(name: string) {
	return Array.filter(stationWords(name), word => word.length >= 3 && !Array.contains(GENERIC, word))
}

export function stationNamesMatch(left: string, right: string) {
	const a = significant(left)
	const b = significant(right)
	const aSet = HashSet.fromIterable(a)
	const bSet = HashSet.fromIterable(b)
	return (
		Array.isArrayNonEmpty(a) &&
		Array.isArrayNonEmpty(b) &&
		(Array.every(a, word => HashSet.has(bSet, word)) || Array.every(b, word => HashSet.has(aSet, word)))
	)
}

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

// The ticket or the provider says the journey will not run; alerts, the island, the phone and the calendar all read this one answer.
export function cancelledOf(booking: Booking) {
	if (booking.status === 'cancelled') return true
	if (Booking.isAnyOf(['stay'])(booking)) return false
	return Option.exists<FlightTracking | TrainTracking>(booking.live, live => live.state === 'cancelled')
}

export function labelled(label: string, value: Option.Option<string>) {
	return Option.map(value, found => `${label} ${found}`)
}

export function line(parts: Option.Option<string>[]) {
	return Array.join(Array.getSomes(parts), ' · ')
}

export function departureOf(booking: Flight | Train) {
	if (Booking.isAnyOf(['train'])(booking)) {
		// Use the departure-specific delay when known; otherwise do not move departure earlier for a negative running delay.
		return DateTime.addDuration(
			booking.departs,
			Option.match(booking.live, {
				onNone: () => Duration.zero,
				onSome: live => Option.getOrElse(live.departureDelay, () => Duration.max(live.delayMinutes, Duration.zero))
			})
		)
	}
	return pipe(
		booking.live,
		Option.flatMap(live => Option.orElse(live.departureActual, () => live.departureEstimated)),
		Option.getOrElse(() => booking.departs)
	)
}

// judge-ignore no-contradicted-promise -- Returns the best known arrival, actual or estimated when live data supplies it and otherwise scheduled.
export function arrivalOf(booking: Flight | Train) {
	if (Booking.isAnyOf(['train'])(booking)) {
		return DateTime.addDuration(
			booking.arrives,
			Option.match(booking.live, {onNone: () => Duration.zero, onSome: live => live.delayMinutes})
		)
	}
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

export function arrivalClockOf(booking: Flight | Train) {
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
	if (Booking.isAnyOf(['flight'])(booking)) return `${booking.airlineCode} ${booking.number}`
	return booking.service
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
		Array.flatMap(Array.getSomes(texts), text => Array.filter(stationWords(text), word => word.length >= 3))
	)
}

// The stay is where the journey ends only when the place names say so: its city among the destination's words, or the destination's city in its address.
function staysAt(stay: Stay, journey: Flight | Train) {
	if (stay.place.timeZone !== journey.to.timeZone) return false
	const destination = wordsOf([journey.to.city, Option.some(journey.to.name)])
	const address = wordsOf([stay.place.city, stay.place.address])
	const city = wordsOf([stay.place.city])
	const arrivalCity = wordsOf([journey.to.city])
	return (
		(HashSet.size(city) > 0 && HashSet.isSubset(city, destination)) ||
		(HashSet.size(arrivalCity) > 0 && HashSet.isSubset(arrivalCity, address))
	)
}

export function stayAfter(bookings: BookingList, journey: Flight | Train) {
	const arrival = arrivalOf(journey)
	const stays = Array.filter(
		bookings,
		(booking): booking is Stay =>
			Booking.isAnyOf(['stay'])(booking) &&
			booking.status === 'confirmed' &&
			staysAt(booking, journey) &&
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

function sameConfirmation(left: Booking, right: Booking) {
	return Option.exists(left.confirmation, code => Option.contains(right.confirmation, code))
}

// A field the newer ticket leaves out keeps what the older one printed.
function newer<A>(existing: Option.Option<A>, incoming: Option.Option<A>) {
	return Option.orElse(incoming, () => existing)
}

// A station's name as words, so an exact name matches whatever its case, accents and punctuation.
function normalizedStation(name: string) {
	return pipe(
		name,
		String.normalize('NFD'),
		String.replaceAll(/[̀-ͯ]/gu, ''),
		String.toLowerCase,
		String.replaceAll(/[^a-z0-9]+/gu, ' '),
		String.trim
	)
}

function sameStation(left: Train['to'], right: Train['from']) {
	return (
		Option.exists(left.code, code => Option.contains(right.code, code)) ||
		normalizedStation(left.name) === normalizedStation(right.name)
	)
}

// A booked station: the stop id Transitous gave its name, when it found one, and the name as the ticket prints it.
export type Wanted = {code: Option.Option<string>; name: string}

// How surely a stop is the booked station: its stop id, then its exact name, then a looser name, under which Milano Rogoredo and Milano Centrale are both Milano.
function rankOf(stop: TransitStop, wanted: Wanted) {
	if (Option.contains(wanted.code, stop.stopId)) return Option.some(0)
	if (normalizedStation(stop.name) === normalizedStation(wanted.name)) return Option.some(1)
	if (stationNamesMatch(wanted.name, stop.name)) return Option.some(2)
	return Option.none()
}

export type Surety = {readonly rank: number}
type StopCandidate = Surety & {readonly index: number}

export const bySurety = Order.mapInput(Number.Order, (candidate: Surety) => candidate.rank)
const surestStop = Order.combine(
	bySurety,
	Order.mapInput(Number.Order, (candidate: StopCandidate) => candidate.index)
)

// The surest stop for the station from `after` on, the earliest among equally sure ones.
function bestStop(stops: readonly TransitStop[], wanted: Wanted, after: number) {
	const found = Array.filterMap(stops, (stop, index) =>
		pipe(
			rankOf(stop, wanted),
			Option.filter(() => index >= after),
			Option.match({onNone: () => Result.failVoid, onSome: rank => Result.succeed({index, rank})})
		)
	)
	if (!Array.isReadonlyArrayNonEmpty(found)) return Option.none()
	return Option.some(Array.min(found, surestStop))
}

// The stretch of one run between the booked stations, each end at its surest stop, ranked so that a run whose stops match exactly wins over one that matches loosely.
export function segmentOf(stops: readonly TransitStop[], from: Wanted, to: Wanted) {
	return Option.flatMap(bestStop(stops, from, 0), first =>
		Option.map(bestStop(stops, to, first.index + 1), last => ({
			rank: first.rank + last.rank,
			stops: pipe(stops, Array.drop(first.index), Array.take(last.index - first.index + 1))
		}))
	)
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

// The same train leg, keyed by operator and origin since one train number runs several legs, or a rebooking under the same confirmation and route; stations compare exactly, never by the timetable's loose match, under which Milano Centrale and Milano Rogoredo are both Milano.
function sameTrain(existing: Train, incoming: Train) {
	if (!sameStation(existing.from, incoming.from)) return false
	return (
		(existing.operator === incoming.operator &&
			existing.number === incoming.number &&
			near(existing.departs, incoming.departs)) ||
		(sameConfirmation(existing, incoming) && sameStation(existing.to, incoming.to))
	)
}

function sameReservation(existing: Booking, incoming: Booking) {
	if (Booking.isAnyOf(['flight'])(existing) && Booking.isAnyOf(['flight'])(incoming)) {
		return sameFlight(existing, incoming)
	}
	if (Booking.isAnyOf(['train'])(existing) && Booking.isAnyOf(['train'])(incoming)) return sameTrain(existing, incoming)
	if (Booking.isAnyOf(['stay'])(existing) && Booking.isAnyOf(['stay'])(incoming)) {
		return (
			sameConfirmation(existing, incoming) ||
			(existing.name === incoming.name && near(existing.checkIn, incoming.checkIn))
		)
	}
	return false
}

function rideFields(existing: Flight | Train, incoming: Flight | Train) {
	return {
		confirmation: newer(existing.confirmation, incoming.confirmation),
		id: existing.id,
		issued: newer(existing.issued, incoming.issued),
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
	if (Booking.isAnyOf(['train'])(existing) && Booking.isAnyOf(['train'])(incoming)) {
		const same =
			existing.number === incoming.number &&
			pipe(DateTime.distance(incoming.departs, existing.departs), Duration.abs, Duration.isLessThanOrEqualTo(HOUR))
		return Train.make({
			...Struct.pick(incoming, Struct.keys(Train.fields)),
			...rideFields(existing, incoming),
			coach: newer(existing.coach, incoming.coach),
			live: Option.filter(existing.live, () => same)
		})
	}
	if (Booking.isAnyOf(['stay'])(existing) && Booking.isAnyOf(['stay'])(incoming)) {
		return Stay.make({
			...Struct.pick(incoming, Struct.keys(Stay.fields)),
			confirmation: newer(existing.confirmation, incoming.confirmation),
			id: existing.id,
			issued: newer(existing.issued, incoming.issued)
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
					// A document dated before the one a booking was read from is older news and changes nothing; when either carries no date, the later share wins.
					const merged = Boolean.match(
						pipe(
							existing.issued,
							Option.zipWith(booking.issued, (stored, read) => Order.isLessThan(String.Order)(read, stored)),
							Option.getOrElse(Function.constFalse)
						),
						{onFalse: () => combine(existing, booking), onTrue: () => existing}
					)
					return [
						Array.map(bookings, item => Boolean.match(item === existing, {onFalse: () => item, onTrue: () => merged})),
						undefined
					] as const
				}
			})
		)
	)[0]
}

// A flight's activity opens three hours ahead, a train's one hour.
export function autoStartOf(legs: Array.NonEmptyReadonlyArray<Flight | Train>) {
	const first = Array.headNonEmpty(legs)
	return DateTime.subtractDuration(first.departs, {flight: Duration.hours(3), train: HOUR}[first._tag])
}

function firstWord(name: string) {
	return Array.headNonEmpty(String.split(name, ' '))
}

function sampleStops(stops: readonly TrainStop[], delay: Duration.Duration, now: DateTime.Utc) {
	if (!Array.isReadonlyArrayNonEmpty(stops)) return []
	const count = Number.min(stops.length, 7)
	return pipe(
		count,
		Array.makeBy(index => Array.get(stops, Number.round((index * (stops.length - 1)) / Number.max(1, count - 1), 0))),
		Array.getSomes,
		// Names shorten to their first word, so Milano Centrale and Milano Rogoredo show once; the widget keys stops by name.
		Array.dedupeWith((left, right) => firstWord(left.name) === firstWord(right.name)),
		Array.map(stop => ({
			name: firstWord(stop.name),
			passed: pipe(
				stop.arrives,
				Option.orElse(() => stop.departs),
				Option.exists(at => pipe(at, DateTime.addDuration(delay), DateTime.isLessThanOrEqualTo(now)))
			)
		}))
	)
}

type ActivityWindow = {end: DateTime.Utc; leg: Leg; start: DateTime.Utc}

function cancelledSeen(leg: Flight | Train) {
	const live: Option.Option<FlightTracking | TrainTracking> = leg.live
	return pipe(
		live,
		Option.filter(found => found.state === 'cancelled'),
		Option.map(found => found.checkedAt)
	)
}

// A journey longer than ActivityKit's eight hours, delays included, gets a second activity for its arrival.
function activityWindows(booking: Booking, legs: readonly (Flight | Train)[], requested: Option.Option<DateTime.Utc>) {
	if (Booking.isAnyOf(['stay'])(booking)) return Array.empty<ActivityWindow>()
	if (!Array.isReadonlyArrayNonEmpty(legs)) return Array.empty<ActivityWindow>()
	const start = Option.match(requested, {
		onNone: () => autoStartOf(legs),
		onSome: at => DateTime.min(at, autoStartOf(legs))
	})
	const last = Option.getOrElse(Array.last(legs), () => booking)
	// A cancellation the provider reported stays on the island for an hour from when it was read, then the activity ends.
	const end = Array.reduce(
		Array.getSomes(Array.map(legs, cancelledSeen)),
		DateTime.addDuration(arrivalOf(last), {flight: Duration.minutes(45), train: Duration.minutes(10)}[last._tag]),
		(earliest, seen) => DateTime.min(earliest, DateTime.addDuration(seen, HOUR))
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
	legs: readonly (Flight | Train)[] = Array.filter([booking], Booking.isAnyOf(['flight', 'train'])),
	requested: Option.Option<DateTime.Utc> = Option.none()
) {
	return Array.findFirst(
		activityWindows(booking, legs, requested),
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

// An old answer stays on the island, plain and dated, so it never reads as the current gate or platform.
function staleNote(live: Option.Option<FlightTracking | TrainTracking>, timeZone: string, stale: boolean) {
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

function lateTone(late: boolean) {
	if (late) return 'warn'
	return 'good'
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

function countdownOf(target: DateTime.Utc, now: DateTime.Utc, counting: boolean) {
	return Option.liftPredicate(target, at => counting && DateTime.isGreaterThan(at, now))
}

function flightActivity(flight: Flight, bookings: BookingList, now: DateTime.Utc, stale: boolean) {
	const phase = flightPhase(flight, now)
	const delay = Number.round(Duration.toMinutes(DateTime.distance(flight.departs, departureOf(flight))), 0)
	return {
		arrivalNote: Option.getOrElse(flight.to.city, () => flight.to.name),
		arrivalTime: arrivalClockOf(flight),
		arrivalTone: 'plain',
		arrives: arrivalOf(flight),
		chip: flightChip(flight, phase, stale),
		countdown: countdownOf(
			flightTarget(flight, phase),
			now,
			phase !== 'landed' && phase !== 'cancelled' && phase !== 'diverted'
		),
		delay: Duration.minutes(delay),
		departureNote: departureNote(phase, delay),
		departureTime: clockAt(departureOf(flight), flight.from.timeZone),
		departureTone: Boolean.match(delay >= 5, {onFalse: Function.constant('plain'), onTrue: Function.constant('warn')}),
		detail: flightDetail(flight, bookings, phase, stale),
		from: Option.getOrElse(flight.from.code, () => flight.from.name),
		headline: flightHeadline(flight, phase),
		kind: 'flight',
		label: flightLabel(phase),
		note: line([labelled('Seat', flight.seat)]),
		phase,
		progressFrom: pipe(
			flight.live,
			Option.flatMap(live => live.takeoffActual),
			Option.filter(() => phase === 'airborne')
		),
		stops: Option.none(),
		symbol: flightSymbol(phase),
		title: titleOf(flight),
		to: Option.getOrElse(flight.to.code, () => flight.to.name),
		tone: flightTone(phase, delay >= 5)
	} satisfies ActivityProps
}

function trainPhase(train: Train, now: DateTime.Utc) {
	if (train.status === 'cancelled' || Option.exists(train.live, live => live.state === 'cancelled')) return 'cancelled'
	if (Option.exists(train.live, live => live.state === 'arrived')) return 'arrived'
	if (Option.exists(train.live, live => live.state === 'departed')) return 'running'
	if (
		Option.exists(train.live, live => Option.isSome(live.departurePlatform)) ||
		DateTime.isGreaterThanOrEqualTo(now, DateTime.subtractDuration(departureOf(train), STATION_LEAD))
	) {
		return 'platform'
	}
	return 'upcoming'
}

function trainHeadline(train: Train, phase: TrainPhase) {
	if (phase === 'running') {
		return Option.getOrElse(
			labelled(
				'Past',
				pipe(
					train.live,
					Option.flatMap(live => live.lastSeen),
					Option.map(seen => seen.station)
				)
			),
			Function.constant('Arrives in')
		)
	}
	if (phase === 'arrived') return `Arrived in ${train.to.name}`
	if (phase === 'cancelled') return 'Cancelled'
	return 'Departs in'
}

function trainLabel(phase: TrainPhase, delay: number) {
	if (phase === 'arrived') return 'Arrived'
	if (phase === 'cancelled') return 'Cancelled'
	if (delay >= 3) return `+${delay}′`
	return 'Now'
}

function platformTone(train: Train) {
	if (
		Option.exists(train.live, live =>
			Option.exists(live.departurePlatformPlanned, planned => !Option.contains(live.departurePlatform, planned))
		)
	) {
		return 'warn'
	}
	return 'plain'
}

function trainChip(train: Train, phase: TrainPhase, stale: boolean) {
	if (phase === 'running' || phase === 'arrived') {
		return Option.map(
			labelled(
				'Bin',
				Option.flatMap(train.live, live => live.arrivalPlatform)
			),
			text => chipOf(text, 'plain')
		)
	}
	return Option.map(
		labelled(
			'Bin',
			Option.flatMap(train.live, live => live.departurePlatform)
		),
		text => chipOf(text, Boolean.match(stale, {onFalse: () => platformTone(train), onTrue: Function.constant('plain')}))
	)
}

function trainTone(phase: TrainPhase, delay: number) {
	if (phase === 'cancelled') return 'bad'
	return lateTone(delay >= 3)
}

function trainDelayNote(phase: TrainPhase, delay: number) {
	if (phase === 'cancelled') return Option.none<string>()
	if (delay >= 3) return Option.some(`${delay}m late`)
	return Option.some('On time')
}

function trainActivity(train: Train, now: DateTime.Utc, stale: boolean) {
	const phase = trainPhase(train, now)
	const delay = Duration.toMinutes(
		Option.match(train.live, {onNone: () => Duration.zero, onSome: live => live.delayMinutes})
	)
	const tone = trainTone(phase, delay)
	return {
		arrivalNote: '',
		arrivalTime: arrivalClockOf(train),
		arrivalTone: tone,
		arrives: arrivalOf(train),
		chip: trainChip(train, phase, stale),
		countdown: countdownOf(
			Boolean.match(phase === 'running', {onFalse: () => departureOf(train), onTrue: () => arrivalOf(train)}),
			now,
			phase !== 'arrived' && phase !== 'cancelled'
		),
		delay: Duration.minutes(delay),
		departureNote: '',
		departureTime: clockAt(departureOf(train), train.from.timeZone),
		departureTone: tone,
		detail: line([
			labelled('Coach', train.coach),
			labelled('Seat', train.seat),
			Option.flatMap(train.live, () => trainDelayNote(phase, delay)),
			staleNote(train.live, train.from.timeZone, stale)
		]),
		from: train.from.name,
		headline: trainHeadline(train, phase),
		kind: 'train',
		label: trainLabel(phase, delay),
		note: '',
		phase,
		progressFrom: Option.none(),
		stops: Option.some(
			sampleStops(
				train.stops,
				Option.match(train.live, {onNone: () => Duration.zero, onSome: live => live.delayMinutes}),
				now
			)
		),
		symbol: Boolean.match(phase === 'cancelled', {
			onFalse: Function.constant('tram.fill'),
			onTrue: Function.constant('exclamationmark.triangle.fill')
		}),
		title: titleOf(train),
		to: train.to.name,
		tone
	} satisfies ActivityProps
}

function activityProps(journey: Flight | Train, bookings: BookingList, now: DateTime.Utc, stale: boolean) {
	if (Booking.isAnyOf(['flight'])(journey)) return ActivityProps.make(flightActivity(journey, bookings, now, stale))
	return ActivityProps.make(trainActivity(journey, now, stale))
}

export function urgencyOf(props: ActivityProps) {
	return `${props.phase}|${Option.match(props.chip, {onNone: Function.constant(''), onSome: chip => chip.text})}|${Number.round(Duration.toMinutes(props.delay) / 5, 0)}`
}

function scheduledStart(booking: Booking) {
	if (Booking.isAnyOf(['stay'])(booking)) return booking.checkIn
	return booking.departs
}

// The change between two trains; a late first train that reaches the station after the next one leaves puts the connection at risk rather than leaving negative minutes.
export function changeOf(from: Flight | Train, to: Flight | Train) {
	const minutes = Number.round(Duration.toMinutes(DateTime.distance(arrivalOf(from), departureOf(to))), 0)
	if (minutes <= 0) return `Connection at risk at ${from.to.name}`
	return `Change at ${from.to.name} · ${minutes} min`
}

export function journeysOf(bookings: BookingList) {
	return pipe(
		bookings,
		Array.sort(Order.mapInput(DateTime.Order, scheduledStart)),
		Array.mapAccum(Array.empty<Array.NonEmptyArray<Booking>>(), (journeys, booking) => {
			const previous = Array.findFirstIndex(journeys, journey => {
				const last = Array.lastNonEmpty(journey)
				if (
					!Booking.isAnyOf(['train'])(booking) ||
					booking.status !== 'confirmed' ||
					!Booking.isAnyOf(['train'])(last) ||
					last.status !== 'confirmed'
				) {
					return false
				}
				const gap = DateTime.toEpochMillis(booking.departs) - DateTime.toEpochMillis(last.arrives)
				return sameStation(last.to, booking.from) && gap >= 0 && gap <= 10_800_000
			})
			return [
				Option.match(previous, {
					onNone: () => Array.append(journeys, [booking]),
					onSome: index =>
						Array.map(journeys, (journey, position) =>
							Boolean.match(position === index, {onFalse: () => journey, onTrue: () => Array.append(journey, booking)})
						)
				}),
				undefined
			] as const
		})
	)[0]
}

// Landed counts as arrived on the phone, the island and the server alike.
export function arrived(leg: Flight | Train, now: DateTime.Utc) {
	if (DateTime.isGreaterThanOrEqualTo(now, arrivalOf(leg))) return true
	if (Booking.isAnyOf(['train'])(leg)) return Option.exists(leg.live, live => live.state === 'arrived')
	return Option.exists(leg.live, live => live.state === 'arrived' || live.state === 'landed')
}

// One cancelled leg cancels the journey: no new Live Activity starts, however it is asked for.
export function cancelledJourney(legs: readonly (Flight | Train)[]): boolean {
	return Array.some(legs, cancelledOf)
}

export function startable(
	legs: readonly (Flight | Train)[],
	now: DateTime.Utc
): legs is Array.NonEmptyReadonlyArray<Flight | Train> {
	return (
		Array.isReadonlyArrayNonEmpty(legs) &&
		!cancelledJourney(legs) &&
		!arrived(Array.lastNonEmpty(legs), now) &&
		DateTime.isGreaterThanOrEqualTo(now, DateTime.subtractDuration(Array.headNonEmpty(legs).departs, Duration.hours(7)))
	)
}

export function journeyProps(
	legs: Array.NonEmptyReadonlyArray<Flight | Train>,
	bookings: BookingList,
	now: DateTime.Utc,
	stale: (leg: Flight | Train) => boolean
) {
	const [current, index] = pipe(
		legs,
		Array.findFirstWithIndex(leg => !arrived(leg, now)),
		Option.getOrElse(() => [Array.lastNonEmpty(legs), legs.length - 1] as const)
	)
	const props = activityProps(current, bookings, now, stale(current))
	return pipe(
		legs,
		Array.get(index + 1),
		Option.match({onNone: () => props, onSome: next => ActivityProps.make({...props, note: changeOf(current, next)})})
	)
}
