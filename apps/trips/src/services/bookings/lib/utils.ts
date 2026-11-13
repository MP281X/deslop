import {Array, Boolean, DateTime, Number, Option, Order, Record, String, Struct, pipe} from 'effect'

import {ActivityProps, Flight, Stay, Train} from '#services/bookings/schema.ts'
import type {
	Booking,
	BookingList,
	Chip,
	FlightPhase,
	Leg,
	LocalTime,
	Tone,
	TrainPhase
} from '#services/bookings/schema.ts'

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

export const AIRPORT_LEAD = 2 * HOUR
const STATION_LEAD = 15 * MINUTE

// ActivityKit ends a Live Activity after eight hours; half an hour stays in reserve for delays.
export const ACTIVITY_LIFETIME = 7.5 * HOUR

export const ACTIVITY_NAME = 'JourneyActivity'

// A time with an offset or Z stands for itself.
export function instantOf(time: LocalTime, timeZone: string) {
	if (Option.isSome(String.match(/(?:Z|[+-]\d{2}:?\d{2})$/u)(time))) {
		return Option.map(DateTime.make(time), DateTime.toEpochMillis)
	}
	// The wall-clock parts, read in the place's zone without dropping seconds or fractions.
	return Option.map(DateTime.makeZoned(time, {adjustForTimeZone: true, timeZone}), DateTime.toEpochMillis)
}

export function clockAt(time: number, timeZone: string) {
	return DateTime.format(DateTime.makeUnsafe(time), {
		hour: '2-digit',
		hourCycle: 'h23',
		locale: 'en-GB',
		minute: '2-digit',
		timeZone
	})
}

export function labelled(label: string, value: Option.Option<string>) {
	return Option.map(value, found => `${label} ${found}`)
}

export function line(parts: Option.Option<string>[]) {
	return Array.join(Array.getSomes(parts), ' · ')
}

export function departureOf(booking: Flight | Train) {
	if (booking._tag === 'train') {
		const live = Option.getOrUndefined(booking.live)
		// A train still to leave waits for its timetable, however early it runs before.
		return booking.departs + (live?.departureDelay ?? Number.max(live?.delayMinutes ?? 0, 0)) * MINUTE
	}
	const live = Option.getOrUndefined(booking.live)
	return live?.departureActual ?? live?.departureEstimated ?? booking.departs
}

export function arrivalOf(booking: Flight | Train) {
	if (booking._tag === 'train') {
		return booking.arrives + Option.match(booking.live, {onNone: () => 0, onSome: live => live.delayMinutes}) * MINUTE
	}
	const live = Option.getOrUndefined(booking.live)
	return live?.arrivalActual ?? live?.arrivalEstimated ?? booking.arrives
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

export function titleOf(booking: Booking) {
	if (booking._tag === 'stay') return booking.name
	if (booking._tag === 'flight') return `${booking.airlineCode} ${booking.number}`
	const brand = Option.getOrElse(Record.get(TRAIN_BRANDS, String.toLowerCase(String.trim(booking.operatorName))), () =>
		String.toUpperCase(String.slice(0, 3)(booking.operatorName))
	)
	return `${brand} ${booking.number}`
}

export function routeOf(booking: Booking) {
	if (booking._tag === 'stay') return booking.place.city ?? booking.place.address ?? booking.name
	return `${booking.from.city ?? booking.from.name} → ${booking.to.city ?? booking.to.name}`
}

export function stayAfter(bookings: BookingList, journey: Flight | Train) {
	const arrival = arrivalOf(journey)
	const stays = Array.filter(
		bookings,
		(booking): booking is Stay =>
			booking._tag === 'stay' &&
			booking.status === 'confirmed' &&
			booking.checkIn > arrival - 12 * HOUR &&
			booking.checkIn < arrival + 36 * HOUR &&
			booking.checkOut > arrival
	)
	if (Array.isReadonlyArrayNonEmpty(stays)) return Option.some(Array.min(stays, byStart))
	return Option.none<Stay>()
}

function near(left: number, right: number) {
	return Math.abs(left - right) < 20 * HOUR
}

function sameConfirmation(left: Booking, right: Booking) {
	return Option.exists(left.confirmation, code => Option.contains(right.confirmation, code))
}

// A field the newer ticket leaves out keeps what the older one printed.
function newer<A>(existing: Option.Option<A>, incoming: Option.Option<A>) {
	return Option.orElse(incoming, () => existing)
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

// The newer ticket wins field by field; the id stays, and live data survives only while it describes the same service.
function combine(existing: Booking, incoming: Booking) {
	if (existing._tag === 'flight' && incoming._tag === 'flight') {
		const same =
			existing.airlineCode === incoming.airlineCode &&
			existing.number === incoming.number &&
			Math.abs(incoming.departs - existing.departs) <= HOUR
		return Flight.make({
			...Struct.pick(incoming, Struct.keys(Flight.fields)),
			boardingAt: newer(existing.boardingAt, incoming.boardingAt),
			// fallow-ignore-next-line code-duplication -- Flight and train schemas share field names; each constructor retains its own typed live tracking.
			boardingGroup: newer(existing.boardingGroup, incoming.boardingGroup),
			confirmation: newer(existing.confirmation, incoming.confirmation),
			id: existing.id,
			live: Option.filter(existing.live, () => same),
			seat: newer(existing.seat, incoming.seat)
		})
	}
	if (existing._tag === 'train' && incoming._tag === 'train') {
		const same = existing.number === incoming.number && Math.abs(incoming.departs - existing.departs) <= HOUR
		return Train.make({
			...Struct.pick(incoming, Struct.keys(Train.fields)),
			coach: newer(existing.coach, incoming.coach),
			confirmation: newer(existing.confirmation, incoming.confirmation),
			id: existing.id,
			live: Option.filter(existing.live, () => same),
			seat: newer(existing.seat, incoming.seat)
		})
	}
	if (existing._tag === 'stay' && incoming._tag === 'stay') {
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
	const state = Option.getOrUndefined(flight.live)?.state
	if (flight.status === 'cancelled' || state === 'cancelled') return 'cancelled'
	if (state === 'diverted') return 'diverted'
	if (state === 'landed' || state === 'arrived') return 'landed'
	if (state === 'departed' || state === 'airborne') return 'airborne'
	if (Option.exists(flight.boardingAt, at => now >= at)) return 'boarding'
	if (now >= departureOf(flight) - 45 * MINUTE) return 'gate'
	if (now >= departureOf(flight) - AIRPORT_LEAD) return 'airport'
	return 'leave'
}

function flightTarget(flight: Flight, phase: FlightPhase) {
	if (phase === 'leave') return departureOf(flight) - AIRPORT_LEAD
	if (phase === 'airport' || phase === 'gate') return Option.getOrElse(flight.boardingAt, () => departureOf(flight))
	if (phase === 'boarding') return departureOf(flight)
	return arrivalOf(flight)
}

function flightHeadline(flight: Flight, phase: FlightPhase) {
	if (phase === 'leave') return `Leave for ${flight.from.code ?? flight.from.name}`
	if (phase === 'airport') {
		return Option.getOrElse(
			labelled(
				'Terminal',
				Option.flatMapNullishOr(flight.live, live => live.departureTerminal)
			),
			() => 'At the airport'
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
				Option.flatMapNullishOr(flight.live, live => live.belt)
			),
			() => `Landed in ${flight.to.city ?? flight.to.name}`
		)
	}
	if (phase === 'diverted') return 'Diverted'
	return 'Cancelled'
}

function flightDetail(flight: Flight, bookings: BookingList, phase: FlightPhase) {
	if (phase === 'landed') {
		return pipe(
			stayAfter(bookings, flight),
			Option.map(stay => `Next: ${stay.name}`),
			Option.orElse(() =>
				labelled(
					'Gate',
					Option.flatMapNullishOr(flight.live, live => live.arrivalGate)
				)
			),
			Option.getOrElse(() => '')
		)
	}
	return line([
		labelled('Group', flight.boardingGroup),
		labelled(
			'was',
			Option.flatMapNullishOr(flight.live, live => live.previousGate)
		)
	])
}

function chipOf(text: string, tone: Tone) {
	return {text, tone} satisfies Chip
}

function flightChip(flight: Flight, phase: FlightPhase) {
	if (phase === 'landed') {
		return Option.map(
			labelled(
				'Belt',
				Option.flatMapNullishOr(flight.live, live => live.belt)
			),
			text => chipOf(text, 'plain')
		)
	}
	return pipe(
		flight.live,
		Option.flatMapNullishOr(live => live.departureGate),
		Option.orElse(() =>
			pipe(
				flight.live,
				Option.flatMapNullishOr(live => live.departureTerminal),
				Option.map(terminal => `T${terminal}`)
			)
		),
		Option.map(text => chipOf(text, 'warn'))
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
		...pipe(
			flight.live,
			Option.flatMapNullishOr(live => live.takeoffActual),
			Option.filter(() => phase === 'airborne'),
			Option.match({onNone: () => ({}), onSome: progressFrom => ({progressFrom})})
		),
		arrivalNote: flight.to.city ?? flight.to.name,
		arrivalTime: clockAt(arrivalOf(flight), flight.to.timeZone),
		arrivalTone: 'plain',
		arrives: arrivalOf(flight),
		delay,
		departureNote: departureNote(phase, delay),
		departureTime: clockAt(departureOf(flight), flight.from.timeZone),
		departureTone: Boolean.match(delay >= 5, {onFalse: () => 'plain', onTrue: () => 'warn'}),
		detail: flightDetail(flight, bookings, phase),
		from: flight.from.code ?? flight.from.name,
		headline: flightHeadline(flight, phase),
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
	const live = Option.getOrUndefined(train.live)
	if (live?.state === 'arrived') return 'arrived'
	if (live?.state === 'departed') return 'running'
	if (live?.departurePlatform !== undefined || now >= departureOf(train) - STATION_LEAD) return 'platform'
	return 'upcoming'
}

function trainHeadline(train: Train, phase: TrainPhase) {
	if (phase === 'running') {
		return Option.getOrElse(
			labelled(
				'Past',
				Option.flatMapNullishOr(train.live, live => live.lastSeen?.station)
			),
			() => 'Arrives in'
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
		Option.exists(
			train.live,
			live => live.departurePlatformPlanned !== undefined && live.departurePlatform !== live.departurePlatformPlanned
		)
	) {
		return 'warn'
	}
	return 'plain'
}

function trainChip(train: Train, phase: TrainPhase) {
	if (phase === 'running' || phase === 'arrived') {
		return Option.map(
			labelled(
				'Bin',
				Option.flatMapNullishOr(train.live, live => live.arrivalPlatform)
			),
			text => chipOf(text, 'plain')
		)
	}
	return Option.map(
		labelled(
			'Bin',
			Option.flatMapNullishOr(train.live, live => live.departurePlatform)
		),
		text => chipOf(text, platformTone(train))
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

function trainActivity(train: Train, now: number) {
	const phase = trainPhase(train, now)
	const delay = Option.match(train.live, {onNone: () => 0, onSome: live => live.delayMinutes})
	const tone = trainTone(phase, delay)
	return {
		...Option.match(trainChip(train, phase), {onNone: () => ({}), onSome: chip => ({chip})}),
		...countdownOf(
			Boolean.match(phase === 'running', {onFalse: () => departureOf(train), onTrue: () => arrivalOf(train)}),
			now,
			phase !== 'arrived' && phase !== 'cancelled'
		),
		arrivalNote: '',
		arrivalTime: clockAt(arrivalOf(train), train.to.timeZone),
		arrivalTone: tone,
		arrives: arrivalOf(train),
		delay,
		departureNote: '',
		departureTime: clockAt(departureOf(train), train.from.timeZone),
		departureTone: tone,
		detail: line([labelled('Coach', train.coach), labelled('Seat', train.seat), trainDelayNote(phase, delay)]),
		from: train.from.name,
		headline: trainHeadline(train, phase),
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

export function urgencyOf(props: ActivityProps) {
	return `${props.phase}|${props.chip?.text ?? ''}|${Number.round(props.delay / 5, 0)}`
}
