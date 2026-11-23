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
	Redacted,
	Result,
	String,
	pipe
} from 'effect'

import {
	ACTIVITY_LIFETIME,
	activeWindow,
	airportByOf,
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

// Per app: refresh the activity that covers the window, or start one with the app's push-to-start token; an ended one stays ended, and a cancelled flight only shows its cancellation on a running one.
export function showPlan(
	devices: readonly Device[],
	activities: readonly Activity[],
	flight: Flight,
	window: Span & {leg: Leg}
) {
	const starters = Array.filter(devices, device => device.kind === 'start' && !cancelledOf(flight))
	const covering = Array.filter(
		activities,
		item => item.flightId === flight.id && item.leg === window.leg && holds(item, window)
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

// Running activities whose window has passed, or whose flight is gone.
export function expiredActivities(activities: readonly Activity[], flights: FlightList, now: DateTime.Utc) {
	const byId = Array.groupBy(flights, flight => flight.id)
	return Array.filter(
		activities,
		activity =>
			Option.isNone(activity.endedAt) &&
			!Option.exists(Array.head(byId[activity.flightId] ?? []), found =>
				Option.exists(activeWindow(found, now), window => window.leg === activity.leg)
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

function cityOf(place: Place) {
	return Option.getOrElse(place.city, () => place.name)
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

// The whole minutes a flight leaves after its booked time, or once it left lands after it, since only the landing can still move; counted in fifteen-minute steps so a drifting estimate stays quiet, 14:30 late is 14 minutes, under the first step. A landing's steps are kept apart from the departure's, so each is told once.
function delayStep(flight: Flight, left: boolean) {
	const delay = Math.floor(
		Duration.toMinutes(
			Boolean.match(left, {
				onFalse: () => DateTime.distance(flight.departs, departureOf(flight)),
				onTrue: () => DateTime.distance(flight.arrives, arrivalOf(flight))
			})
		)
	)
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

// The flight he changes from: one that lands where this one leaves, booked within twelve hours before it, the latest such one. A flight with one is a connection: no trip from home leads to it, and only the change between the two is told.
export function feederOf(flight: Flight, flights: FlightList) {
	return pipe(
		flights,
		Array.filter(
			other =>
				other.id !== flight.id &&
				!cancelledOf(other) &&
				Option.isSome(other.to.code) &&
				Equal.equals(other.to.code, flight.from.code) &&
				pipe(
					other.arrives,
					DateTime.distance(flight.departs),
					change =>
						Duration.isGreaterThan(change, Duration.zero) && Duration.isLessThanOrEqualTo(change, Duration.hours(12))
				)
		),
		Array.last
	)
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
	const boards = Option.map(flight.boardingAt, at =>
		DateTime.addDuration(at, Duration.minutes(Number.max(0, delay.delay)))
	)
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
