import {Array, Boolean, DateTime, Number, Option, Order, Record, String, Struct, pipe} from 'effect'

import {ActivityProps} from '#services/bookings/schema.ts'
import type {
	Booking,
	BookingId,
	BookingList,
	Chip,
	Flight,
	FlightPhase,
	Leg,
	LocalTime,
	Stay,
	Tone,
	Train,
	TrainPhase
} from '#services/bookings/schema.ts'

// The short brand codes Trenitalia prints before a train number.
const TRAIN_BRANDS: Record.ReadonlyRecord<string, string> = {
	frecciabianca: 'FB',
	frecciargento: 'FA',
	frecciarossa: 'FR',
	intercity: 'IC',
	'intercity notte': 'ICN',
	italo: 'ITA',
	regionale: 'REG',
	'regionale veloce': 'RV'
}

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

// How long before departure to be at the airport or on the platform.
const AIRPORT_LEAD = 2 * HOUR
const STATION_LEAD = 15 * MINUTE

// ActivityKit ends a Live Activity after eight hours; half an hour stays in reserve for delays.
export const ACTIVITY_LIFETIME = 7.5 * HOUR

// The name the app passes to createLiveActivity, which the pushes repeat.
export const ACTIVITY_NAME = 'JourneyActivity'

// Time

// A local "2026-10-28T16:40" read in the place's zone; a time with an offset or Z stands for itself.
export function instantOf(time: LocalTime, timeZone: string) {
	if (Option.isSome(String.match(/(?:Z|[+-]\d{2}:?\d{2})$/u)(time))) {
		return Option.map(DateTime.make(time), DateTime.toEpochMillis)
	}
	// The wall-clock minutes, read as parts of the place's zone.
	return pipe(
		DateTime.makeZoned(`${String.slice(0, 16)(time)}:00Z`, {adjustForTimeZone: true, timeZone}),
		Option.map(DateTime.toEpochMillis)
	)
}

// "16:40" in the place's own time zone.
function clockAt(time: number, timeZone?: string) {
	return DateTime.format(DateTime.makeUnsafe(time), {
		hour: '2-digit',
		hourCycle: 'h23',
		locale: 'en-GB',
		minute: '2-digit',
		timeZone: timeZone ?? 'UTC'
	})
}

// Wording

// "Seat 14A", or nothing when the booking does not know the seat.
export function labelled(label: string, value?: string) {
	return Option.map(Option.fromUndefinedOr(value), found => `${label} ${found}`)
}

// The parts a line knows, joined the way a departures board lists them.
function line(parts: Option.Option<string>[]) {
	return Array.join(Array.getSomes(parts), ' · ')
}

// Bookings

export function departureOf(booking: Flight | Train) {
	if (booking._tag === 'train') {
		// A train still to leave waits for its timetable, however early it runs before.
		return booking.departs + (booking.live?.departureDelay ?? Number.max(booking.live?.delayMinutes ?? 0, 0)) * MINUTE
	}
	return booking.live?.departureActual ?? booking.live?.departureEstimated ?? booking.departs
}

export function arrivalOf(booking: Flight | Train) {
	if (booking._tag === 'train') return booking.arrives + (booking.live?.delayMinutes ?? 0) * MINUTE
	return booking.live?.arrivalActual ?? booking.live?.arrivalEstimated ?? booking.arrives
}

export function startOf(booking: Booking) {
	if (booking._tag === 'stay') return booking.checkIn
	return departureOf(booking)
}

export function endOf(booking: Booking) {
	if (booking._tag === 'stay') return booking.checkOut
	return arrivalOf(booking)
}

export const byStart = Order.mapInput(Order.Number, startOf)

// "BA 553", "FR 9541" or the stay's name.
export function titleOf(booking: Booking) {
	if (booking._tag === 'stay') return booking.name
	if (booking._tag === 'flight') return `${booking.airlineCode} ${booking.number}`
	const brand = Option.getOrElse(Record.get(TRAIN_BRANDS, String.toLowerCase(String.trim(booking.operatorName))), () =>
		String.toUpperCase(String.slice(0, 3)(booking.operatorName))
	)
	return `${brand} ${booking.number}`
}

// "Rome → London", or the stay's city.
export function routeOf(booking: Booking) {
	if (booking._tag === 'stay') return booking.place.city ?? booking.place.address ?? booking.name
	return `${booking.from.city ?? booking.from.name} → ${booking.to.city ?? booking.to.name}`
}

// The stay that starts around a journey's arrival, for the ride from the airport or station.
export function stayAfter(bookings: BookingList, journey: Flight | Train) {
	const arrival = arrivalOf(journey)
	return Array.findFirst(
		Array.sort(
			Array.filter(bookings, (booking): booking is Stay => booking._tag === 'stay' && booking.status === 'confirmed'),
			byStart
		),
		stay => stay.checkIn > arrival - 12 * HOUR && stay.checkIn < arrival + 36 * HOUR && stay.checkOut > arrival
	)
}

function near(left: number, right: number) {
	return Math.abs(left - right) < 20 * HOUR
}

function sameConfirmation(left: Booking, right: Booking) {
	return left.confirmation !== undefined && left.confirmation === right.confirmation
}

// The same segment, keyed by origin since BA15 flies two legs a day, or a rebooking under the same confirmation and route.
function sameReservation(existing: Booking, incoming: Booking) {
	if (existing._tag === 'flight' && incoming._tag === 'flight') {
		return (
			(existing.airlineCode === incoming.airlineCode &&
				existing.number === incoming.number &&
				existing.from.code === incoming.from.code &&
				near(existing.departs, incoming.departs)) ||
			(sameConfirmation(existing, incoming) &&
				existing.from.code === incoming.from.code &&
				existing.to.code === incoming.to.code)
		)
	}
	if (existing._tag === 'train' && incoming._tag === 'train') {
		return (
			(existing.operator === incoming.operator &&
				existing.number === incoming.number &&
				near(existing.departs, incoming.departs)) ||
			(sameConfirmation(existing, incoming) &&
				existing.from.name === incoming.from.name &&
				existing.to.name === incoming.to.name)
		)
	}
	if (existing._tag === 'stay' && incoming._tag === 'stay') {
		return (
			sameConfirmation(existing, incoming) ||
			(existing.name === incoming.name && near(existing.checkIn, incoming.checkIn))
		)
	}
	return false
}

// The newer ticket wins field by field; the id, the first sighting and every source stay, and live data survives only while it describes the same service.
function combine(existing: Booking, incoming: Booking) {
	const kept = {
		createdAt: existing.createdAt,
		id: existing.id,
		sources: Array.dedupe([...existing.sources, ...incoming.sources])
	}
	if (existing._tag === 'flight' && incoming._tag === 'flight') {
		const merged = {...existing, ...incoming, ...kept}
		if (
			existing.airlineCode === incoming.airlineCode &&
			existing.number === incoming.number &&
			Math.abs(incoming.departs - existing.departs) <= HOUR
		) {
			return merged
		}
		return Struct.omit(merged, ['live'])
	}
	if (existing._tag === 'train' && incoming._tag === 'train') {
		const merged = {...existing, ...incoming, ...kept}
		if (existing.number === incoming.number && Math.abs(incoming.departs - existing.departs) <= HOUR) return merged
		return Struct.omit(merged, ['live'])
	}
	if (existing._tag === 'stay' && incoming._tag === 'stay') return {...existing, ...incoming, ...kept}
	return {...incoming, ...kept}
}

// Each incoming booking replaces the reservation it matches or joins the list; returns the list and the ids touched.
export function upsert(current: BookingList, incoming: BookingList) {
	return Array.reduce(incoming, {bookings: current, ids: Array.empty<BookingId>()}, (state, booking) =>
		Option.match(
			Array.findFirst(state.bookings, existing => sameReservation(existing, booking)),
			{
				onNone: () => ({bookings: [...state.bookings, booking], ids: [...state.ids, booking.id]}),
				onSome: existing => {
					const merged = combine(existing, booking)
					return {
						bookings: Array.map(state.bookings, item =>
							Boolean.match(item === existing, {onFalse: () => item, onTrue: () => merged})
						),
						ids: [...state.ids, merged.id]
					}
				}
			}
		)
	)
}

// Live checks

// How often to ask the flight provider; none once it cannot answer yet or has nothing more to say.
function flightInterval(flight: Flight, now: number) {
	const departure = departureOf(flight)
	const arrival = arrivalOf(flight)
	const state = flight.live?.state
	if (flight.status === 'cancelled' || state === 'cancelled' || state === 'diverted') return Option.none<number>()
	// FlightAware answers at most two days ahead.
	if (now < flight.departs - 47 * HOUR || now > arrival + 2 * HOUR) return Option.none<number>()
	if (state === 'arrived') {
		if (flight.live?.belt === undefined && now < arrival + 45 * MINUTE) return Option.some(5 * MINUTE)
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
	if (train.status === 'cancelled' || train.operator !== 'trenitalia' || train.live?.state === 'arrived') {
		return Option.none<number>()
	}
	if (now < train.departs - 6 * HOUR || now > arrivalOf(train) + 30 * MINUTE) return Option.none<number>()
	if (now < train.departs - 90 * MINUTE) return Option.some(30 * MINUTE)
	return Option.some(MINUTE)
}

// How often a provider is asked about the journey now; none while it is not tracked.
export function checkEvery(booking: Booking, now: number) {
	if (booking._tag === 'stay') return Option.none<number>()
	if (booking._tag === 'flight') return flightInterval(booking, now)
	return trainInterval(booking, now)
}

// The last attempt counts, answered or not, so a failing provider is asked on the same schedule.
export function isDue(booking: Booking, now: number, attemptedAt: number) {
	if (booking._tag === 'stay') return false
	const checkedAt = booking.live?.checkedAt ?? 0
	return Option.exists(checkEvery(booking, now), every => now - Number.max(checkedAt, attemptedAt) >= every)
}

// Live data that missed two of the checks due after it no longer describes the journey, even once tracking stopped; an arrival is final.
export function isStale(booking: Booking, now: number) {
	if (booking._tag === 'stay' || booking.live === undefined || booking.live.state === 'arrived') return false
	const checkedAt = booking.live.checkedAt
	return Option.exists(checkEvery(booking, checkedAt), every => now - checkedAt > 2 * every + 2 * MINUTE)
}

// Live Activities

type ActivityWindow = {end: number; leg: Leg; start: number}

// A journey longer than ActivityKit's eight hours, delays included, gets a second activity for its arrival.
function activityWindows(booking: Booking) {
	if (booking._tag === 'stay') return Array.empty<ActivityWindow>()
	const start = booking.departs - {flight: 3 * HOUR, train: HOUR}[booking._tag]
	const end = arrivalOf(booking) + {flight: 45 * MINUTE, train: 10 * MINUTE}[booking._tag]
	if (end - start <= ACTIVITY_LIFETIME) return [{end, leg: 'departure', start}] satisfies ActivityWindow[]
	const departed = Number.min(departureOf(booking) + 45 * MINUTE, start + ACTIVITY_LIFETIME)
	return [
		{end: departed, leg: 'departure', start},
		{end, leg: 'arrival', start: Number.max(departed, end - ACTIVITY_LIFETIME)}
	] satisfies ActivityWindow[]
}

export function activeWindow(booking: Booking, now: number) {
	return Array.findFirst(activityWindows(booking), window => window.start <= now && now < window.end)
}

function flightPhase(flight: Flight, now: number) {
	const state = flight.live?.state
	if (flight.status === 'cancelled' || state === 'cancelled') return 'cancelled'
	if (state === 'diverted') return 'diverted'
	if (state === 'landed' || state === 'arrived') return 'landed'
	if (state === 'departed' || state === 'airborne') return 'airborne'
	if (flight.boardingAt !== undefined && now >= flight.boardingAt) return 'boarding'
	if (now >= departureOf(flight) - 45 * MINUTE) return 'gate'
	if (now >= departureOf(flight) - AIRPORT_LEAD) return 'airport'
	return 'leave'
}

// What the timer counts down to in each phase.
function flightTarget(flight: Flight, phase: FlightPhase) {
	if (phase === 'leave') return departureOf(flight) - AIRPORT_LEAD
	if (phase === 'airport' || phase === 'gate') return flight.boardingAt ?? departureOf(flight)
	if (phase === 'boarding') return departureOf(flight)
	return arrivalOf(flight)
}

function flightHeadline(flight: Flight, phase: FlightPhase) {
	if (phase === 'leave') return `Leave for ${flight.from.code ?? flight.from.name}`
	if (phase === 'airport') {
		return Option.getOrElse(labelled('Terminal', flight.live?.departureTerminal), () => 'At the airport')
	}
	if (phase === 'gate') {
		if (flight.boardingAt === undefined) return 'Departs in'
		return 'Boards in'
	}
	if (phase === 'boarding') return 'Boarding'
	if (phase === 'airborne') return 'Lands in'
	if (phase === 'landed') {
		return Option.getOrElse(
			labelled('Bags on belt', flight.live?.belt),
			() => `Landed in ${flight.to.city ?? flight.to.name}`
		)
	}
	if (phase === 'diverted') return 'Diverted'
	return 'Cancelled'
}

function flightDetail(flight: Flight, bookings: BookingList, phase: FlightPhase) {
	if (phase === 'landed') {
		return Option.getOrElse(
			Option.orElse(
				Option.map(stayAfter(bookings, flight), stay => `Next: ${stay.name}`),
				() => labelled('Gate', flight.live?.arrivalGate)
			),
			() => ''
		)
	}
	return line([
		labelled('Seat', flight.seat),
		labelled('Group', flight.boardingGroup),
		labelled('was', flight.live?.previousGate)
	])
}

function chipOf(text: string, tone: Tone) {
	return {text, tone} satisfies Chip
}

function flightChip(flight: Flight, phase: FlightPhase) {
	if (phase === 'landed') return Option.map(labelled('Belt', flight.live?.belt), text => chipOf(text, 'plain'))
	return Option.map(
		Option.orElse(Option.fromUndefinedOr(flight.live?.departureGate), () =>
			Option.map(Option.fromUndefinedOr(flight.live?.departureTerminal), terminal => `T${terminal}`)
		),
		text => chipOf(text, 'warn')
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

// The timer runs only toward a time still ahead.
function countdownOf(target: number, now: number, counting: boolean) {
	if (!counting || target <= now) return {}
	return {countdown: target}
}

function flightActivity(flight: Flight, bookings: BookingList, now: number) {
	const phase = flightPhase(flight, now)
	const delay = Number.round((departureOf(flight) - flight.departs) / MINUTE, 0)
	return {
		...Option.match(flightChip(flight, phase), {onNone: () => ({}), onSome: chip => ({chip})}),
		...countdownOf(
			flightTarget(flight, phase),
			now,
			phase !== 'landed' && phase !== 'cancelled' && phase !== 'diverted'
		),
		...Option.match(
			Option.filter(Option.fromUndefinedOr(flight.live?.takeoffActual), () => phase === 'airborne'),
			{onNone: () => ({}), onSome: progressFrom => ({progressFrom})}
		),
		arrivalNote: flight.to.city ?? flight.to.name,
		arrivalTime: clockAt(arrivalOf(flight), flight.to.timeZone),
		arrivalTone: 'plain',
		arrives: arrivalOf(flight),
		delay,
		departs: departureOf(flight),
		departureNote: departureNote(phase, delay),
		departureTime: clockAt(departureOf(flight), flight.from.timeZone),
		departureTone: Boolean.match(delay >= 5, {onFalse: () => 'plain', onTrue: () => 'warn'}),
		detail: flightDetail(flight, bookings, phase),
		from: flight.from.code ?? flight.from.name,
		headline: flightHeadline(flight, phase),
		id: flight.id,
		kind: 'flight',
		label: flightLabel(phase),
		note: line([labelled('Seat', flight.seat)]),
		phase,
		symbol: flightSymbol(phase),
		title: titleOf(flight),
		to: flight.to.code ?? flight.to.name,
		tone: flightTone(phase, delay >= 5)
	} satisfies ActivityProps
}

function trainPhase(train: Train, now: number) {
	if (train.status === 'cancelled') return 'cancelled'
	if (train.live?.state === 'arrived') return 'arrived'
	if (train.live?.state === 'running' || train.live?.state === 'departed') return 'running'
	if (train.live?.departurePlatform !== undefined || now >= departureOf(train) - STATION_LEAD) return 'platform'
	return 'upcoming'
}

function trainHeadline(train: Train, phase: TrainPhase) {
	if (phase === 'running') return Option.getOrElse(labelled('Past', train.live?.lastSeen?.station), () => 'Arrives in')
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
		train.live?.departurePlatformPlanned !== undefined &&
		train.live.departurePlatform !== train.live.departurePlatformPlanned
	) {
		return 'warn'
	}
	return 'plain'
}

// The platform to board from, then the one the train arrives at once it left.
function trainChip(train: Train, phase: TrainPhase) {
	if (phase === 'running' || phase === 'arrived') {
		return Option.map(labelled('Bin', train.live?.arrivalPlatform), text => chipOf(text, 'plain'))
	}
	return Option.map(labelled('Bin', train.live?.departurePlatform), text => chipOf(text, platformTone(train)))
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

function trainActivity(train: Train, now: number) {
	const phase = trainPhase(train, now)
	const delay = train.live?.delayMinutes ?? 0
	const tone = trainTone(phase, delay)
	return {
		...Option.match(trainChip(train, phase), {onNone: () => ({}), onSome: chip => ({chip})}),
		...countdownOf(
			Boolean.match(phase === 'running', {onFalse: () => departureOf(train), onTrue: () => arrivalOf(train)}),
			now,
			phase !== 'arrived' && phase !== 'cancelled'
		),
		arrivalNote: '',
		arrivalTime: clockAt(arrivalOf(train), train.to.timeZone ?? 'Europe/Rome'),
		arrivalTone: tone,
		arrives: arrivalOf(train),
		delay,
		departs: departureOf(train),
		departureNote: '',
		departureTime: clockAt(departureOf(train), train.from.timeZone ?? 'Europe/Rome'),
		departureTone: tone,
		detail: line([labelled('Coach', train.coach), labelled('Seat', train.seat), trainDelayNote(phase, delay)]),
		from: train.from.name,
		headline: trainHeadline(train, phase),
		id: train.id,
		kind: 'train',
		label: trainLabel(phase, delay),
		note: '',
		phase,
		symbol: Boolean.match(phase === 'cancelled', {
			onFalse: () => 'tram.fill',
			onTrue: () => 'exclamationmark.triangle.fill'
		}),
		title: titleOf(train),
		to: train.to.name,
		tone
	} satisfies ActivityProps
}

export function activityProps(journey: Flight | Train, bookings: BookingList, now: number) {
	if (journey._tag === 'flight') return ActivityProps.make(flightActivity(journey, bookings, now))
	return ActivityProps.make(trainActivity(journey, now))
}

// What moves the island at once rather than on the next low-priority push.
export function urgencyOf(props: ActivityProps) {
	return `${props.phase}|${props.chip?.text ?? ''}|${Number.round(props.delay / 5, 0)}`
}

// The notification that comes with an activity the server starts; iOS shows none without one.
export function startAlert(journey: Flight | Train) {
	if (journey._tag === 'flight') {
		return {
			body: line([Option.some(routeOf(journey)), labelled('Gate', journey.live?.departureGate)]),
			title: titleOf(journey)
		}
	}
	return {
		body: line([Option.some(routeOf(journey)), labelled('Platform', journey.live?.departurePlatform)]),
		title: titleOf(journey)
	}
}

// Alerts

export type Alert = {body: string; key: string; title: string}

function trainAlerts(train: Train) {
	const title = titleOf(train)
	const departure = clockAt(departureOf(train), train.from.timeZone ?? 'Europe/Rome')
	return Array.getSomes([
		Option.filter(
			Option.some<Alert>({
				body: `${routeOf(train)} at ${clockAt(train.departs, train.from.timeZone ?? 'Europe/Rome')}`,
				key: 'cancelled',
				title: `${title} is cancelled`
			}),
			() => train.status === 'cancelled'
		),
		Option.map(
			// Worth a notification only while the train is still to board.
			Option.filter(Option.fromUndefinedOr(train.live?.departurePlatform), () => train.live?.state === 'scheduled'),
			platform =>
				({
					body: line([Option.some(`${train.from.name} at ${departure}`), labelled('coach', train.coach)]),
					key: `platform:${platform}`,
					title: `${title} · Platform ${platform}`
				}) satisfies Alert
		),
		Option.map(
			Option.filter(Option.fromUndefinedOr(train.live?.delayMinutes), delay => delay >= 10),
			delay =>
				({
					body: `Now leaves ${train.from.name} at ${departure}`,
					key: `delay:${Number.round(delay / 10, 0) * 10}`,
					title: `${title} is ${delay} min late`
				}) satisfies Alert
		)
	])
}

function flightAlerts(flight: Flight, now: number) {
	const title = titleOf(flight)
	const departure = clockAt(departureOf(flight), flight.from.timeZone)
	const delay = Number.round((departureOf(flight) - flight.departs) / MINUTE, 0)
	const cancelled = flight.status === 'cancelled' || flight.live?.state === 'cancelled'
	return Array.getSomes([
		Option.filter(
			Option.some<Alert>({
				body: `${routeOf(flight)} at ${clockAt(flight.departs, flight.from.timeZone)}`,
				key: 'cancelled',
				title: `${title} is cancelled`
			}),
			() => cancelled
		),
		Option.filter(
			Option.some<Alert>({body: routeOf(flight), key: 'diverted', title: `${title} is diverted`}),
			() => flight.live?.state === 'diverted'
		),
		Option.map(
			Option.fromUndefinedOr(flight.live?.departureGate),
			gate =>
				({
					body: Option.getOrElse(labelled('Changed from', flight.live?.previousGate), () =>
						line([Option.some(`Departs ${departure}`), labelled('Terminal', flight.live?.departureTerminal)])
					),
					key: `gate:${gate}`,
					title: `${title} · Gate ${gate}`
				}) satisfies Alert
		),
		Option.filter(
			Option.some<Alert>({
				body: `Now departs ${departure}`,
				key: `delay:${Number.round(delay / 15, 0) * 15}`,
				title: `${title} is ${delay} min late`
			}),
			() => delay >= 15 && !cancelled
		),
		Option.map(
			Option.filter(
				Option.fromUndefinedOr(flight.boardingAt),
				at => now >= at - 10 * MINUTE && now < departureOf(flight)
			),
			at =>
				({
					body: line([
						Option.orElseSome(labelled('Gate', flight.live?.departureGate), () => 'Check the gate'),
						labelled('group', flight.boardingGroup)
					]),
					key: 'boarding',
					title: `${title} boards at ${clockAt(at, flight.from.timeZone)}`
				}) satisfies Alert
		),
		Option.map(
			Option.fromUndefinedOr(flight.live?.belt),
			belt => ({body: flight.to.name, key: `belt:${belt}`, title: `${title} bags on belt ${belt}`}) satisfies Alert
		)
	])
}

// The changes worth a notification, each under a key sent once; a delay counts in steps so a drifting estimate stays quiet.
export function alertsFor(booking: Booking, now: number) {
	if (booking._tag === 'stay' || now > arrivalOf(booking) + HOUR || now < booking.departs - 30 * HOUR) {
		return Array.empty<Alert>()
	}
	if (booking._tag === 'train') return trainAlerts(booking)
	return flightAlerts(booking, now)
}
