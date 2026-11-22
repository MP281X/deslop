import {Array, Boolean, DateTime, Duration, Function, Number, Option, Redacted, Result, String, pipe} from 'effect'

import type {Device} from '@deslop/runtime/shared/apns'

import {
	ACTIVITY_LIFETIME,
	activeWindow,
	arrivalClockOf,
	arrivalOf,
	cancelledJourney,
	cancelledOf,
	clockAt,
	departureOf,
	labelled,
	line,
	routeOf,
	titleOf
} from '#services/bookings/lib/utils.ts'
import {Booking} from '#services/bookings/schema.ts'
import type {Flight, Leg, Train} from '#services/bookings/schema.ts'
import {ShowAction} from '#services/push/schema.ts'
import type {Activity, AlertCategory, AlertDelivery, SentAlert, StartRequest} from '#services/push/schema.ts'
import {isStale} from '#services/tracking/lib/utils.ts'

export type Span = {end: DateTime.Utc; start: DateTime.Utc}

// An activity covers the window while ActivityKit keeps it alive, unless it ended before the window began.
export function holds(activity: Activity, window: Span) {
	if (pipe(activity.startedAt, DateTime.addDuration(ACTIVITY_LIFETIME), DateTime.isLessThan(window.end))) return false
	return Option.match(activity.endedAt, {
		onNone: Function.constTrue,
		onSome: ended => DateTime.isGreaterThanOrEqualTo(ended, window.start)
	})
}

// A gate, platform or belt is a value each phone must end on, so it is reconciled per device, never skipped for a booking-wide record; the other categories are once per booking.
export function perDevice(alert: Alert) {
	return alert.value !== undefined && alert.category !== 'delay'
}

// `sent` holds the keys sent for the booking, oldest first.
export function announced(sent: readonly SentAlert[], alert: Alert) {
	if (alert.value === undefined || alert.category === 'delay') {
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

// Per app: refresh the activity that covers the leg, or start one with the app's push-to-start token; an ended one stays ended, and a cancelled journey only shows its cancellation on a running one.
export function showPlan(
	devices: readonly Device[],
	activities: readonly Activity[],
	legs: Array.NonEmptyReadonlyArray<Flight | Train>,
	window: Span & {leg: Leg},
	requested: Option.Option<DateTime.Utc> = Option.none()
) {
	const starters = Array.filter(devices, device => device.kind === 'start' && !cancelledJourney(legs))
	const covering = Array.filter(
		activities,
		item =>
			item.bookingId === Array.headNonEmpty(legs).id &&
			item.leg === window.leg &&
			holds(item, window) &&
			!Option.exists(item.endedAt, ended => Option.exists(requested, at => DateTime.isGreaterThan(at, ended)))
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

// Running activities whose leg is no longer in its window, or whose booking is gone; `journeys` is the round's one grouping of the bookings.
export function expiredActivities(
	activities: readonly Activity[],
	journeys: readonly Array.NonEmptyReadonlyArray<Booking>[],
	now: DateTime.Utc,
	requests: readonly StartRequest[] = []
) {
	const requestsById = Array.groupBy(requests, request => request.bookingId)
	const byId = Array.groupBy(journeys, legs => legs[0].id)
	return Array.filter(
		activities,
		activity =>
			Option.isNone(activity.endedAt) &&
			!Option.exists(Array.head(byId[activity.bookingId] ?? []), found =>
				Option.exists(
					activeWindow(
						found[0],
						now,
						Array.filter(found, (booking): booking is Flight | Train => !Booking.isAnyOf(['stay'])(booking)),
						Option.map(Array.head(requestsById[activity.bookingId] ?? []), request => request.at)
					),
					window => window.leg === activity.leg
				)
			)
	)
}

// The notification that comes with an activity the server starts; iOS shows none without one.
export function startAlert(journey: Flight | Train) {
	if (Booking.isAnyOf(['flight'])(journey)) {
		return {
			body: line([
				Option.some(routeOf(journey)),
				labelled(
					'Gate',
					Option.flatMap(journey.live, live => live.departureGate)
				)
			]),
			title: titleOf(journey)
		}
	}
	return {
		body: line([
			Option.some(routeOf(journey)),
			labelled(
				'Platform',
				Option.flatMap(journey.live, live => live.departurePlatform)
			)
		]),
		title: titleOf(journey)
	}
}

export type Alert = {body: string; title: string; category: AlertCategory; value?: string}

function trainAlerts(train: Train, stale: boolean) {
	const title = titleOf(train)
	const departure = clockAt(departureOf(train), train.from.timeZone)
	if (cancelledOf(train)) {
		return Array.of<Alert>({
			body: `${routeOf(train)} at ${clockAt(train.departs, train.from.timeZone)}`,
			category: 'cancelled',
			title: `${title} is cancelled`
		})
	}
	// An answer that stopped updating stays on screen, dated, but is never announced as news.
	const live = Option.filter(train.live, () => !stale)
	return Array.getSomes([
		pipe(
			live,
			Option.filter(found => found.state === 'scheduled'),
			Option.flatMap(found => found.departurePlatform),
			Option.map(
				platform =>
					({
						body: line([Option.some(`${train.from.name} at ${departure}`), labelled('coach', train.coach)]),
						category: 'platform',
						title: `${title} · Platform ${platform}`,
						value: platform
					}) satisfies Alert
			)
		),
		pipe(
			live,
			Option.filter(found => Duration.toMinutes(found.delayMinutes) >= 10),
			Option.map(
				found =>
					({
						// Once it left, the delay is what it runs with, and only the arrival can still move.
						body: Boolean.match(found.state === 'scheduled', {
							onFalse: () => `Now arrives in ${train.to.name} at ${arrivalClockOf(train)}`,
							onTrue: () => `Now leaves ${train.from.name} at ${departure}`
						}),
						category: 'delay',
						title: `${title} is ${Duration.toMinutes(found.delayMinutes)} min late`,
						value: `${Number.round(Duration.toMinutes(found.delayMinutes) / 10, 0) * 10}`
					}) satisfies Alert
			)
		)
	])
}

function flightAlerts(flight: Flight, now: DateTime.Utc, stale: boolean) {
	const title = titleOf(flight)
	const departure = clockAt(departureOf(flight), flight.from.timeZone)
	if (cancelledOf(flight)) {
		return Array.of<Alert>({
			body: `${routeOf(flight)} at ${clockAt(flight.departs, flight.from.timeZone)}`,
			category: 'cancelled',
			title: `${title} is cancelled`
		})
	}
	const delay = Number.round(Duration.toMinutes(DateTime.distance(flight.departs, departureOf(flight))), 0)
	const live = Option.filter(flight.live, () => !stale)
	const left = Option.exists(flight.live, report => report.state !== 'scheduled')
	return Array.getSomes([
		Option.filter(
			Option.some<Alert>({body: routeOf(flight), category: 'diverted', title: `${title} is diverted`}),
			() => Option.exists(flight.live, report => report.state === 'diverted')
		),
		pipe(
			live,
			Option.filter(() => !left),
			Option.flatMap(report => report.departureGate),
			Option.map(
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
				// Once it left, the delay is history, and only the landing can still move.
				body: Boolean.match(left, {
					onFalse: () => `Now departs ${departure}`,
					onTrue: () => `Now lands ${arrivalClockOf(flight)}`
				}),
				category: 'delay',
				title: `${title} is ${delay} min late`,
				value: `${Number.round(delay / 15, 0) * 15}`
			}),
			() => delay >= 15 && Option.isSome(live)
		),
		pipe(
			flight.boardingAt,
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
							labelled('group', flight.boardingGroup)
						]),
						category: 'boarding',
						title: `${title} boards at ${clockAt(at, flight.from.timeZone)}`
					}) satisfies Alert
			)
		),
		pipe(
			live,
			Option.flatMap(report => report.belt),
			Option.map(
				belt =>
					({
						body: flight.to.name,
						category: 'belt',
						title: `${title} bags on belt ${belt}`,
						value: belt
					}) satisfies Alert
			)
		)
	])
}

// The changes worth a notification, each under a key sent once; a delay counts in steps so a drifting estimate stays quiet, and a cancellation is the only news a cancelled journey gets.
export function alertsOf(booking: Booking, now: DateTime.Utc) {
	if (
		Booking.isAnyOf(['stay'])(booking) ||
		DateTime.isGreaterThan(now, DateTime.addDuration(arrivalOf(booking), Duration.hours(1))) ||
		DateTime.isLessThan(now, DateTime.subtractDuration(booking.departs, Duration.hours(30)))
	) {
		return Array.empty<Alert>()
	}
	if (Booking.isAnyOf(['train'])(booking)) return trainAlerts(booking, isStale(booking, now))
	return flightAlerts(booking, now, isStale(booking, now))
}
