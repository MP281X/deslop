import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Function,
	HashSet,
	Number,
	Option,
	Redacted,
	Result,
	String,
	pipe
} from 'effect'

import {
	ACTIVITY_LIFETIME,
	airportByOf,
	autoStartOf,
	boardsAt,
	changeLine,
	cityOf,
	feederOf,
	delayLine,
	delayOf,
	landingDelayOf,
	stepOf,
	arrivalClockOf,
	arrivalOf,
	cancelledOf,
	clockAt,
	daysBetween,
	departureOf,
	HOUR,
	isBooked,
	labelled,
	leaveByOf,
	line,
	routeOf,
	titleOf,
	travellersLine
} from '#services/flights/lib/utils.ts'
import type {Journey, Step} from '#services/flights/lib/utils.ts'
import {ActivityProps} from '#services/flights/schema.ts'
import type {FlightList, Flight, Leg, Place, Traveller, TravelTime} from '#services/flights/schema.ts'
import {ShowAction} from '#services/push/schema.ts'
import type {Activity, AlertCategory, AlertDelivery, Device, SentAlert} from '#services/push/schema.ts'
import {isStale} from '#services/tracking/lib/utils.ts'

// Ryanair's free check-in opens 72 hours before departure and closes 2 hours before, per its help centre in November 2026; other airlines get the common 24 hours, closing an hour before.
const RYANAIR = ['FR', 'RK']

// What a running Live Activity tells as its own alert, in place of a notification.
const ACTIVITY_CATEGORIES = HashSet.make<AlertCategory[]>(
	'cancelled',
	'diverted',
	'gate',
	'delay',
	'boarding',
	'connection'
)

export type Span = {end: DateTime.Utc; start: DateTime.Utc}

// An activity covers the window while ActivityKit keeps it alive, unless it ended before the window began.
export function holds(activity: Activity, window: Span) {
	if (pipe(activity.startedAt, DateTime.addDuration(ACTIVITY_LIFETIME), DateTime.isLessThan(window.end))) return false
	return Option.match(activity.endedAt, {
		onNone: Function.constTrue,
		onSome: ended => DateTime.isGreaterThanOrEqualTo(ended, window.start)
	})
}

// A delay and a connection count down in steps, each told once, however the estimate drifts back.
function stepped(alert: Alert) {
	return alert.category === 'delay' || alert.category === 'connection'
}

// A gate is a value each phone must end on, so it is reconciled per device, never skipped for a flight-wide record; the other categories are once per flight.
export function perDevice(alert: Alert) {
	return alert.value !== undefined && !stepped(alert)
}

// `sent` holds the keys sent for the flight, oldest first.
export function announced(sent: readonly SentAlert[], alert: Alert) {
	if (alert.value === undefined || stepped(alert)) {
		return Array.some(
			sent,
			found =>
				found.category === alert.category &&
				Option.makeEquivalence(String.Equivalence)(found.value, Option.fromUndefinedOr(alert.value))
		)
	}
	return pipe(
		sent,
		Array.findLast(found => found.category === alert.category),
		Option.exists(found => Option.contains(found.value, alert.value))
	)
}

// Retry only devices without a terminal answer for this alert; one phone's acceptance says nothing about another.
export function unannouncedDevices(devices: readonly Device[], deliveries: readonly AlertDelivery[], alert: Alert) {
	return Array.filter(
		devices,
		device =>
			!announced(
				Array.filter(deliveries, delivery => Redacted.value(delivery.token) === Redacted.value(device.token)),
				alert
			)
	)
}

export function ridesActivity(alert: Alert) {
	return HashSet.has(ACTIVITY_CATEGORIES, alert.category)
}

// The alert tokens of the iPhone and app an activity runs on, the only ones its alerts reach.
export function activityPhones(devices: readonly Device[], activity: Activity) {
	return Array.filter(
		devices,
		device => device.kind === 'alert' && device.bundle === activity.bundle && device.phone === activity.phone
	)
}

// The changes a running activity tells as its own alert: those its iPhone still awaits as a notification. Other phones get them as notifications.
export function ridingAlerts(
	alerts: readonly Alert[],
	sent: readonly SentAlert[],
	deliveries: readonly AlertDelivery[],
	devices: readonly Device[],
	activity: Activity
) {
	const phones = activityPhones(devices, activity)
	return Array.filter(
		alerts,
		alert =>
			ridesActivity(alert) &&
			(perDevice(alert) || !announced(sent, alert)) &&
			Array.isReadonlyArrayNonEmpty(unannouncedDevices(phones, deliveries, alert))
	)
}

type ActivityWindow = {end: DateTime.Utc; leg: Leg; start: DateTime.Utc}

// The day's activity, from its start to three quarters of an hour after the last landing, or an hour after a cancellation was read. A day longer than ActivityKit's eight hours is cut at the last takeoff the first activity still covers, and a second activity shows the rest.
function activityWindows(journey: Journey, now: DateTime.Utc, travel: readonly TravelTime[]) {
	const start = autoStartOf(journey, travel)
	const landed = DateTime.addDuration(arrivalOf(Array.lastNonEmpty(journey)), Duration.minutes(45))
	const end = pipe(
		stepOf(journey, now, travel).flight.live,
		Option.filter(live => live.state === 'cancelled'),
		Option.map(live => pipe(live.checkedAt, DateTime.addDuration(HOUR), DateTime.min(landed))),
		Option.getOrElse(() => landed)
	)
	if (pipe(start, DateTime.distance(end), Duration.isLessThanOrEqualTo(ACTIVITY_LIFETIME))) {
		return [{end, leg: 'departure', start}] satisfies ActivityWindow[]
	}
	const limit = DateTime.addDuration(start, ACTIVITY_LIFETIME)
	const cut = pipe(
		journey,
		Array.map(flight => DateTime.addDuration(departureOf(flight), Duration.minutes(45))),
		Array.filter(at => DateTime.isGreaterThan(at, start) && DateTime.isLessThanOrEqualTo(at, limit)),
		Array.last,
		Option.getOrElse(() => limit)
	)
	return [
		{end: cut, leg: 'departure', start},
		{end, leg: 'arrival', start: DateTime.max(cut, DateTime.subtractDuration(end, ACTIVITY_LIFETIME))}
	] satisfies ActivityWindow[]
}

export function activeWindow(journey: Journey, now: DateTime.Utc, travel: readonly TravelTime[]) {
	return Array.findFirst(
		activityWindows(journey, now, travel),
		window => DateTime.isLessThanOrEqualTo(window.start, now) && DateTime.isLessThan(now, window.end)
	)
}

// Per app: refresh the activity that covers the window, or start one with the app's push-to-start token; an ended one stays ended, and a day whose every flight is cancelled only shows its cancellation on a running one. A day's activities are kept under its first flight.
export function showPlan(
	devices: readonly Device[],
	activities: readonly Activity[],
	journey: Journey,
	window: Span & {leg: Leg}
) {
	const id = Array.headNonEmpty(journey).id
	const starters = Array.filter(devices, device => device.kind === 'start' && !Array.every(journey, cancelledOf))
	const covering = Array.filter(
		activities,
		item => item.flightId === id && item.leg === window.leg && holds(item, window)
	)
	const startersByBundle = Array.groupBy(starters, device => device.bundle)
	const coveringByBundle = Array.groupBy(covering, item => item.bundle)
	return Array.filterMap(
		Array.dedupe([...Array.map(starters, device => device.bundle), ...Array.map(covering, item => item.bundle)]),
		bundle =>
			Option.match(Array.head(coveringByBundle[bundle] ?? []), {
				onNone: () =>
					Option.match(Array.head(startersByBundle[bundle] ?? []), {
						onNone: () => Result.failVoid,
						onSome: target => Result.succeed<ShowAction>(ShowAction.cases.launch.make({target}))
					}),
				onSome: target => {
					if (Option.isSome(target.endedAt)) return Result.failVoid
					return Result.succeed<ShowAction>(ShowAction.cases.refresh.make({target}))
				}
			})
	)
}

// Running activities whose window has passed, or whose day is gone.
export function expiredActivities(
	activities: readonly Activity[],
	journeys: readonly Journey[],
	now: DateTime.Utc,
	travel: readonly TravelTime[]
) {
	return Array.filter(
		activities,
		activity =>
			Option.isNone(activity.endedAt) &&
			!pipe(
				journeys,
				Array.findFirst(journey => Array.headNonEmpty(journey).id === activity.flightId),
				Option.flatMap(journey => activeWindow(journey, now, travel)),
				Option.exists(window => window.leg === activity.leg)
			)
	)
}

// The notification that comes with an activity the server starts; iOS shows none without one.
export function startAlert(flight: Flight) {
	return {
		body: line([
			Option.some(routeOf(flight)),
			labelled(
				'Gate',
				Option.flatMap(flight.live, live => live.departureGate)
			)
		]),
		title: titleOf(flight)
	}
}

// `directions` is the airport a notification's Directions and Uber actions lead to.
export type Alert = {body: string; title: string; category: AlertCategory; value?: string; directions?: Place}

export type AlertContext = {flights: FlightList; travel: readonly TravelTime[]}

function checkInOf(flight: Flight) {
	if (Array.contains(RYANAIR, flight.airlineCode)) {
		return {
			closes: DateTime.subtractDuration(flight.departs, Duration.hours(2)),
			opens: DateTime.subtractDuration(flight.departs, Duration.hours(72))
		}
	}
	return {
		closes: DateTime.subtractDuration(flight.departs, HOUR),
		opens: DateTime.subtractDuration(flight.departs, Duration.hours(24))
	}
}

// Each traveller still booked needs their own boarding pass, so one traveller's pass leaves the others reminded. A flight with no traveller named is one traveller without a pass.
function withoutPass(flight: Flight) {
	if (Array.isReadonlyArrayEmpty(flight.travellers)) {
		return Array.of<Traveller>({
			boardingGroup: Option.none(),
			boardingPass: false,
			confirmation: Option.none(),
			name: Option.none(),
			seat: Option.none(),
			status: 'confirmed',
			ticket: Option.none()
		})
	}
	return Array.filter(flight.travellers, traveller => isBooked(traveller) && !traveller.boardingPass)
}

// The plan comes twelve hours before leaving, moved earlier into 09:00–21:00 on the airport's clock, never later, so it neither wakes him nor comes after he is asleep.
function planAt(leave: DateTime.Utc, timeZone: string) {
	const at = DateTime.makeZonedUnsafe(DateTime.subtractDuration(leave, Duration.hours(12)), {timeZone})
	const parts = DateTime.toParts(at)
	const evening = {hour: 21, millisecond: 0, minute: 0, second: 0}
	if (parts.hour < 9) return DateTime.toUtc(pipe(at, DateTime.subtract({days: 1}), DateTime.setParts(evening)))
	if (parts.hour > 21 || (parts.hour === 21 && parts.minute > 0)) return DateTime.toUtc(DateTime.setParts(at, evening))
	return DateTime.toUtc(at)
}

// Between 09:00 and 21:00 on the airport's clock, through the 21:00 minute itself, where the plan may be moved.
function awake(now: DateTime.Utc, timeZone: string) {
	const parts = DateTime.toParts(DateTime.makeZonedUnsafe(now, {timeZone}))
	const minutes = parts.hour * 60 + parts.minute
	return minutes >= 9 * 60 && minutes <= 21 * 60
}

// The day of `to` as said on the day of `from`: "today", "tomorrow" or its weekday.
function dayWord(from: DateTime.Utc, to: DateTime.Utc, timeZone: string) {
	const days = daysBetween(from, timeZone, to, timeZone)
	if (days === 0) return 'today'
	if (days === 1) return 'tomorrow'
	return DateTime.format(to, {locale: 'en-GB', timeZone, weekday: 'long'})
}

function within(now: DateTime.Utc, start: DateTime.Utc, end: DateTime.Utc) {
	return DateTime.isGreaterThanOrEqualTo(now, start) && DateTime.isLessThan(now, end)
}

// The delay of the departure, or once it left of the landing, since only the landing can still move; counted in fifteen-minute steps so a drifting estimate stays quiet, 14 min 30 s late is under the first step. A landing's steps are kept apart from the departure's, so each is told once.
function delayStep(flight: Flight, left: boolean) {
	const delay = Boolean.match(left, {onFalse: () => delayOf(flight), onTrue: () => landingDelayOf(flight)})
	const step = Math.floor(delay / 15) * 15
	return {delay, step, value: Boolean.match(left, {onFalse: () => `${step}`, onTrue: () => `lands ${step}`})}
}

function checkInAlerts(flight: Flight, now: DateTime.Utc) {
	const window = checkInOf(flight)
	const missing = withoutPass(flight)
	if (Array.isReadonlyArrayEmpty(missing)) return Array.empty<Alert>()
	const reminder = DateTime.subtractDuration(window.closes, Duration.hours(12))
	const closes = clockAt(window.closes, flight.from.timeZone)
	return Array.getSomes([
		Option.liftPredicate<Alert>(
			{
				body: `${routeOf(flight)} · Closes ${dayWord(now, window.closes, flight.from.timeZone)} at ${closes}`,
				category: 'checkin',
				title: `Check-in for ${titleOf(flight)} is open`
			},
			() => within(now, window.opens, DateTime.min(reminder, window.closes))
		),
		Option.liftPredicate<Alert>(
			{
				body: line([
					Option.some(`Check-in closes ${dayWord(now, window.closes, flight.from.timeZone)} at ${closes}`),
					labelled(
						'No boarding pass yet for',
						pipe(
							Array.getSomes(Array.map(missing, traveller => traveller.name)),
							Array.join(', '),
							Option.liftPredicate(String.isNonEmpty)
						)
					)
				]),
				category: 'closing',
				title: `Check in for ${titleOf(flight)}`
			},
			() => within(now, reminder, window.closes)
		)
	])
}

// The plan and leave now are for the trip from home, so a flight he connects to gets neither.
function departureAlerts(flight: Flight, now: DateTime.Utc, context: AlertContext) {
	if (Option.isSome(feederOf(flight, context.flights))) return Array.empty<Alert>()
	const airportBy = airportByOf(flight)
	const leaveBy = leaveByOf(flight, context.travel)
	const leave = Option.getOrElse(leaveBy, () => airportBy)
	const timeZone = flight.from.timeZone
	const city = cityOf(flight.from)
	return Array.getSomes([
		Option.liftPredicate<Alert>(
			{
				body: Option.match(leaveBy, {
					onNone: () =>
						`${String.capitalize(dayWord(now, airportBy, timeZone))}: airport by ${clockAt(airportBy, timeZone)} for ${city}`,
					onSome: at =>
						`${String.capitalize(dayWord(now, at, timeZone))}: leave by ${clockAt(at, timeZone)} for ${city}, airport by ${clockAt(airportBy, timeZone)}`
				}),
				category: 'plan',
				title: `${titleOf(flight)} · ${routeOf(flight)}`
			},
			// A plan missed in the night, as after a restart, waits for 09:00, and is dropped once leave now is due.
			() =>
				within(now, planAt(leave, timeZone), DateTime.subtractDuration(leave, Duration.minutes(15))) &&
				awake(now, timeZone)
		),
		pipe(
			leaveBy,
			Option.filter(at => within(now, DateTime.subtractDuration(at, Duration.minutes(15)), airportBy)),
			Option.map<DateTime.Utc, Alert>(at => ({
				body: `Leave by ${clockAt(at, timeZone)}, airport by ${clockAt(airportBy, timeZone)} · ${titleOf(flight)} departs ${clockAt(departureOf(flight), timeZone)}`,
				category: 'leave',
				directions: flight.from,
				title: `Leave now for ${city}`
			}))
		)
	])
}

// A diverted flight lands elsewhere, so it gives no time to change; one that arrived leaves nothing to warn of.
function connectionAlert(flight: Flight, now: DateTime.Utc, flights: FlightList) {
	return pipe(
		feederOf(flight, flights),
		Option.filter(
			feeder =>
				(Option.isSome(feeder.live) || Option.isSome(flight.live)) &&
				DateTime.isLessThan(now, departureOf(flight)) &&
				!Option.exists(feeder.live, live => live.state === 'arrived' || live.state === 'diverted')
		),
		Option.flatMap(feeder => {
			const change = Number.round(Duration.toMinutes(DateTime.distance(arrivalOf(feeder), departureOf(flight))), 0)
			const booked = Duration.toMinutes(DateTime.distance(feeder.arrives, flight.departs))
			return Option.liftPredicate<Alert>(
				{
					body: line([
						Option.some(`${titleOf(feeder)} lands ${arrivalClockOf(feeder)}`),
						Option.some(`${titleOf(flight)} departs ${clockAt(departureOf(flight), flight.from.timeZone)}`),
						labelled(
							'Gate',
							Option.flatMap(flight.live, live => live.departureGate)
						)
					]),
					category: 'connection',
					title: Boolean.match(change > 0, {
						onFalse: () => `${titleOf(flight)} may leave before ${titleOf(feeder)} lands`,
						onTrue: () => `${change} min to change for ${titleOf(flight)}`
					}),
					value: `${Math.floor(change / 15) * 15}`
				},
				() => change < 60 || change <= booked - 15
			)
		})
	)
}

function flightAlerts(flight: Flight, now: DateTime.Utc, stale: boolean, context: AlertContext) {
	const title = titleOf(flight)
	const departure = clockAt(departureOf(flight), flight.from.timeZone)
	if (cancelledOf(flight)) {
		return Array.of<Alert>({
			body: `${routeOf(flight)} at ${clockAt(flight.departs, flight.from.timeZone)}`,
			category: 'cancelled',
			title: `${title} is cancelled`
		})
	}
	const live = Option.filter(flight.live, () => !stale)
	const left = Option.exists(flight.live, report => report.state !== 'scheduled')
	const delay = delayStep(flight, left)
	// Boarding moves with the delay and never comes before the time the pass printed; it is called again when the delay crosses a step, replacing the earlier call.
	const boards = Option.map(flight.boardingAt, () => boardsAt(flight))
	return [
		...Array.getSomes([
			Option.filter(
				Option.some<Alert>({body: routeOf(flight), category: 'diverted', title: `${title} is diverted`}),
				() => Option.exists(flight.live, report => report.state === 'diverted')
			),
			pipe(
				live,
				Option.filter(() => !left),
				Option.flatMap(report => report.departureGate),
				Option.map<string, Alert>(
					gate =>
						({
							body: Option.getOrElse(
								labelled(
									'Changed from',
									Option.flatMap(live, report => report.previousGate)
								),
								() =>
									line([
										Option.some(`Departs ${departure}`),
										labelled(
											'Terminal',
											Option.flatMap(live, report => report.departureTerminal)
										)
									])
							),
							category: 'gate',
							title: `${title} · Gate ${gate}`,
							value: gate
						}) satisfies Alert
				)
			),
			Option.filter(
				Option.some<Alert>({
					// Once it left, the departure's delay is history, and only the landing's is told; the plane flying in is named when it is the cause.
					body: line([
						Option.some(
							Boolean.match(left, {
								onFalse: () => `Now departs ${departure}`,
								onTrue: () => `Now lands ${arrivalClockOf(flight)}`
							})
						),
						pipe(
							live,
							Option.flatMap(report => report.inboundDelay),
							Option.map(Duration.toMinutes),
							Option.filter(late => late >= 15 && !left),
							Option.map(late => `inbound plane ${late} min late`)
						)
					]),
					category: 'delay',
					title: Boolean.match(left, {
						onFalse: () => `${title} is ${delay.delay} min late`,
						onTrue: () => `${title} lands ${delay.delay} min late`
					}),
					value: delay.value
				}),
				() => delay.delay >= 15 && Option.isSome(live)
			),
			pipe(
				boards,
				Option.filter(
					at =>
						!left &&
						DateTime.isGreaterThanOrEqualTo(now, DateTime.subtractDuration(at, Duration.minutes(10))) &&
						DateTime.isLessThan(now, departureOf(flight))
				),
				Option.map<DateTime.Utc, Alert>(
					at =>
						({
							body: line([
								Option.orElseSome(
									labelled(
										'Gate',
										Option.flatMap(live, report => report.departureGate)
									),
									Function.constant('Check the gate')
								),
								labelled(
									'group',
									travellersLine(flight, traveller => traveller.boardingGroup)
								)
							]),
							category: 'boarding',
							title: `${title} boards at ${clockAt(at, flight.from.timeZone)}`,
							value: `${Number.max(0, delay.step)}`
						}) satisfies Alert
				)
			)
		]),
		...checkInAlerts(flight, now),
		...departureAlerts(flight, now, context),
		...Option.toArray(connectionAlert(flight, now, context.flights))
	]
}

// The news worth a notification, each under a key sent once: check-in, the plan and when to leave by the clock, the rest as FlightAware reports it; a cancellation is the only news a cancelled flight gets, from two days out.
export function alertsOf(flight: Flight, now: DateTime.Utc, context: AlertContext) {
	if (
		DateTime.isGreaterThan(now, DateTime.addDuration(arrivalOf(flight), Duration.hours(1))) ||
		(cancelledOf(flight) && DateTime.isLessThan(now, DateTime.subtractDuration(flight.departs, Duration.hours(48))))
	) {
		return Array.empty<Alert>()
	}
	return flightAlerts(flight, now, isStale(flight, now), context)
}

// The zones differ at that moment, so a clock in the destination's zone says so.
function otherZone(flight: Flight) {
	return (
		DateTime.zonedOffset(DateTime.makeZonedUnsafe(arrivalOf(flight), {timeZone: flight.from.timeZone})) !==
		DateTime.zonedOffset(DateTime.makeZonedUnsafe(arrivalOf(flight), {timeZone: flight.to.timeZone}))
	)
}

// Who flies and where they sit, by first name: "Matteo 14C · Anna 14D", or the seats alone for a ticket without names.
function seatsLine(flight: Flight) {
	return pipe(
		flight.travellers,
		Array.map(traveller =>
			Option.map(
				Option.all({name: traveller.name, seat: traveller.seat}),
				found => `${Array.headNonEmpty(String.split(found.name, ' '))} ${found.seat}`
			)
		),
		Array.getSomes,
		Array.match({
			onEmpty: () =>
				labelled(
					'Seats',
					travellersLine(flight, traveller => traveller.seat)
				),
			onNonEmpty: seats => Option.some(Array.join(seats, ' · '))
		})
	)
}

const QUIET = {gate: Option.none(), noteWas: Option.none(), pending: false, untilValue: '', was: Option.none()}

function departsNote(flight: Flight) {
	const late = delayOf(flight) >= 5
	return {
		note: `Departs ${clockAt(departureOf(flight), flight.from.timeZone)}`,
		noteTone: Boolean.match(late, {
			onFalse: Function.constant('plain' as const),
			onTrue: Function.constant('warn' as const)
		}),
		noteWas: Option.liftPredicate(clockAt(flight.departs, flight.from.timeZone), () => late)
	}
}

function gateOf(flight: Flight) {
	return Option.flatMap(flight.live, live => live.departureGate)
}

// The gate it left, struck through beside the gate it moved to.
function movedFrom(flight: Flight) {
	return pipe(
		flight.live,
		Option.flatMap(live => live.previousGate),
		Option.filter(() => Option.isSome(gateOf(flight)))
	)
}

function homeWords(flight: Flight, leave: boolean, travel: readonly TravelTime[]) {
	return {
		...QUIET,
		...departsNote(flight),
		label: Boolean.match(leave, {onFalse: Function.constant('Airport by'), onTrue: Function.constant('Leave by')}),
		small: `${titleOf(flight)} · ${routeOf(flight)}`,
		symbol: 'car.fill' as const,
		until: 'Time left',
		value: clockAt(
			pipe(
				leaveByOf(flight, travel),
				Option.filter(() => leave),
				Option.getOrElse(() => airportByOf(flight))
			),
			flight.from.timeZone
		)
	}
}

// The gate, or for a connection the gate of the flight he changes to, with the route since it is a new flight.
function gateWords(flight: Flight, connection: boolean) {
	const seats = travellersLine(flight, traveller => traveller.seat)
	return {
		...QUIET,
		...departsNote(flight),
		gate: gateOf(flight),
		label: Boolean.match(connection, {onFalse: Function.constant('Gate'), onTrue: () => `Gate for ${titleOf(flight)}`}),
		pending: Option.isNone(gateOf(flight)),
		small: Boolean.match(connection, {
			onFalse: () => line([Option.some(titleOf(flight)), labelled('Seats', seats)]),
			onTrue: () => line([Option.some(titleOf(flight)), Option.some(routeOf(flight)), seats])
		}),
		symbol: 'airplane.departure' as const,
		until: `Boards ${clockAt(boardsAt(flight), flight.from.timeZone)}`,
		value: Option.getOrElse(gateOf(flight), Function.constant('Not yet')),
		was: movedFrom(flight)
	}
}

function boardingWords(flight: Flight) {
	return {
		...QUIET,
		gate: gateOf(flight),
		label: Option.match(gateOf(flight), {
			onNone: Function.constant('Boarding'),
			onSome: Function.constant('Boarding at gate')
		}),
		note: `Lands ${arrivalClockOf(flight)}`,
		noteTone: 'plain' as const,
		small: line([Option.some(titleOf(flight)), seatsLine(flight)]),
		symbol: 'airplane.departure' as const,
		until: `Departs ${clockAt(departureOf(flight), flight.from.timeZone)}`,
		value: Option.getOrElse(gateOf(flight), Function.constant('Now')),
		was: movedFrom(flight)
	}
}

function airborneWords(flight: Flight, next: Option.Option<Flight>) {
	return {
		...QUIET,
		label: Boolean.match(otherZone(flight), {
			onFalse: () => `Lands in ${cityOf(flight.to)}`,
			onTrue: () => `Lands in ${cityOf(flight.to)}, local time`
		}),
		note: Option.match(next, {
			onNone: () => `Departed ${clockAt(departureOf(flight), flight.from.timeZone)}`,
			onSome: found => `${titleOf(found)} at ${clockAt(departureOf(found), found.from.timeZone)}`
		}),
		noteTone: 'plain' as const,
		small: `${titleOf(flight)} · ${routeOf(flight)}`,
		symbol: 'airplane' as const,
		until: 'Time left',
		value: arrivalClockOf(flight)
	}
}

function landedWords(flight: Flight) {
	return {
		...QUIET,
		label: 'Landed in',
		note: '',
		noteTone: 'plain' as const,
		small: `${titleOf(flight)} · ${routeOf(flight)}`,
		symbol: 'airplane.arrival' as const,
		until: 'At',
		untilValue: arrivalClockOf(flight),
		value: cityOf(flight.to)
	}
}

function stoppedWords(flight: Flight, cancelled: boolean) {
	return {
		...QUIET,
		label: titleOf(flight),
		note: '',
		noteTone: 'plain' as const,
		small: routeOf(flight),
		symbol: 'exclamationmark.triangle.fill' as const,
		until: Boolean.match(cancelled, {
			onFalse: Function.constant('Was to land'),
			onTrue: Function.constant('Was to depart')
		}),
		untilValue: Boolean.match(cancelled, {
			onFalse: () => clockAt(flight.arrives, flight.to.timeZone),
			onTrue: () => clockAt(flight.departs, flight.from.timeZone)
		}),
		value: Boolean.match(cancelled, {onFalse: Function.constant('Diverted'), onTrue: Function.constant('Cancelled')})
	}
}

function wordsOf(journey: Journey, current: Step, travel: readonly TravelTime[]) {
	if (current.phase === 'leave' || current.phase === 'airport') {
		return homeWords(current.flight, current.phase === 'leave', travel)
	}
	if (current.phase === 'gate') return gateWords(current.flight, current.index > 0)
	if (current.phase === 'boarding') return boardingWords(current.flight)
	if (current.phase === 'airborne') return airborneWords(current.flight, Array.get(journey, current.index + 1))
	if (current.phase === 'landed') return landedWords(current.flight)
	return stoppedWords(current.flight, current.phase === 'cancelled')
}

// An old answer says when it was read, so it never reads as the current gate; on the way to the airport a delay leads, after it a tight change.
function problemOf(journey: Journey, current: Step, stale: boolean) {
	if (current.phase === 'landed' || current.phase === 'cancelled' || current.phase === 'diverted') {
		return Option.none<string>()
	}
	const late = Option.filter(delayLine(current.flight), () => current.phase === 'leave' || current.phase === 'airport')
	return pipe(
		current.flight.live,
		Option.filter(() => stale),
		Option.map(live => `Updated ${clockAt(live.checkedAt, current.flight.from.timeZone)}`),
		Option.orElse(() => late),
		Option.orElse(() => changeLine(journey, current.index))
	)
}

function toneOf(current: Step, problem: Option.Option<string>) {
	if (current.phase === 'cancelled' || current.phase === 'diverted') return 'bad'
	if (Option.isSome(problem)) return 'warn'
	return 'plain'
}

// What the day's activity shows at `current`, worded for the widget.
export function activityProps(journey: Journey, current: Step, travel: readonly TravelTime[], stale: boolean) {
	const problem = problemOf(journey, current, stale)
	return ActivityProps.make({
		...wordsOf(journey, current, travel),
		deadline: current.deadline,
		delay: Duration.minutes(delayOf(current.flight)),
		phase: current.phase,
		problem,
		segment: current.segment,
		segmentSince: current.segmentSince,
		segmentUntil: current.segmentUntil,
		since: current.since,
		tone: toneOf(current, problem)
	})
}

// A new phase, flight, gate or five more minutes of delay comes at once; anything else may wait for the phone.
export function urgencyOf(props: ActivityProps) {
	return `${props.phase}|${props.label}|${Option.getOrElse(props.gate, Function.constant(''))}|${Number.round(Duration.toMinutes(props.delay) / 5, 0)}`
}
