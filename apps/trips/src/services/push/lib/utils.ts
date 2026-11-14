import {Array, DateTime, Duration, Function, Number, Option, Result, String, pipe} from 'effect'

import {
	ACTIVITY_LIFETIME,
	activeWindow,
	arrivalOf,
	clockAt,
	departureOf,
	labelled,
	line,
	routeOf,
	titleOf
} from '#services/bookings/lib/utils.ts'
import {Booking} from '#services/bookings/schema.ts'
import type {BookingList, Flight, Leg, Train} from '#services/bookings/schema.ts'
import {ShowAction} from '#services/push/schema.ts'
import type {Activity, AlertCategory, Device, SentAlert} from '#services/push/schema.ts'

export type Span = {end: DateTime.Utc; start: DateTime.Utc}

// An activity covers the window while ActivityKit keeps it alive, unless it ended before the window began.
export function holds(activity: Activity, window: Span) {
	if (pipe(activity.startedAt, DateTime.addDuration(ACTIVITY_LIFETIME), DateTime.isLessThan(window.end))) return false
	return Option.match(activity.endedAt, {
		onNone: Function.constTrue,
		onSome: ended => DateTime.isGreaterThanOrEqualTo(ended, window.start)
	})
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

// Per app: refresh the activity that covers the leg, or start one with the app's push-to-start token; an ended one stays ended.
export function showPlan(
	devices: readonly Device[],
	activities: readonly Activity[],
	journey: Flight | Train,
	window: Span & {leg: Leg}
) {
	const starters = Array.filter(devices, device => device.kind === 'start')
	const covering = Array.filter(
		activities,
		item => item.bookingId === journey.id && item.leg === window.leg && holds(item, window)
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

// Running activities whose leg is no longer in its window, or whose booking is gone.
export function expiredActivities(activities: readonly Activity[], all: BookingList, now: DateTime.Utc) {
	const byId = Array.groupBy(all, booking => booking.id)
	return Array.filter(
		activities,
		activity =>
			Option.isNone(activity.endedAt) &&
			!Option.exists(Array.head(byId[activity.bookingId] ?? []), found =>
				Option.exists(activeWindow(found, now), window => window.leg === activity.leg)
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

function trainAlerts(train: Train) {
	const title = titleOf(train)
	const departure = clockAt(departureOf(train), train.from.timeZone)
	return Array.getSomes([
		Option.filter(
			Option.some<Alert>({
				body: `${routeOf(train)} at ${clockAt(train.departs, train.from.timeZone)}`,
				category: 'cancelled',
				title: `${title} is cancelled`
			}),
			() => train.status === 'cancelled'
		),
		pipe(
			train.live,
			Option.filter(live => live.state === 'scheduled'),
			Option.flatMap(live => live.departurePlatform),
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
			train.live,
			Option.map(live => Duration.toMinutes(live.delayMinutes)),
			Option.filter(delay => delay >= 10),
			Option.map(
				delay =>
					({
						body: `Now leaves ${train.from.name} at ${departure}`,
						category: 'delay',
						title: `${title} is ${delay} min late`,
						value: `${Number.round(delay / 10, 0) * 10}`
					}) satisfies Alert
			)
		)
	])
}

function flightAlerts(flight: Flight, now: DateTime.Utc) {
	const title = titleOf(flight)
	const departure = clockAt(departureOf(flight), flight.from.timeZone)
	const delay = Number.round(Duration.toMinutes(DateTime.distance(flight.departs, departureOf(flight))), 0)
	const cancelled = flight.status === 'cancelled' || Option.exists(flight.live, report => report.state === 'cancelled')
	return Array.getSomes([
		Option.filter(
			Option.some<Alert>({
				body: `${routeOf(flight)} at ${clockAt(flight.departs, flight.from.timeZone)}`,
				category: 'cancelled',
				title: `${title} is cancelled`
			}),
			() => cancelled
		),
		Option.filter(
			Option.some<Alert>({body: routeOf(flight), category: 'diverted', title: `${title} is diverted`}),
			() => Option.exists(flight.live, report => report.state === 'diverted')
		),
		pipe(
			flight.live,
			Option.flatMap(report => report.departureGate),
			Option.map(
				gate =>
					({
						body: Option.getOrElse(
							labelled(
								'Changed from',
								Option.flatMap(flight.live, report => report.previousGate)
							),
							() =>
								line([
									Option.some(`Departs ${departure}`),
									labelled(
										'Terminal',
										Option.flatMap(flight.live, report => report.departureTerminal)
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
				body: `Now departs ${departure}`,
				category: 'delay',
				title: `${title} is ${delay} min late`,
				value: `${Number.round(delay / 15, 0) * 15}`
			}),
			() => delay >= 15 && !cancelled
		),
		pipe(
			flight.boardingAt,
			Option.filter(
				at =>
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
									Option.flatMap(flight.live, report => report.departureGate)
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
			flight.live,
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

// The changes worth a notification, each under a key sent once; a delay counts in steps so a drifting estimate stays quiet.
export function alertsOf(booking: Booking, now: DateTime.Utc) {
	if (
		Booking.isAnyOf(['stay'])(booking) ||
		DateTime.isGreaterThan(now, DateTime.addDuration(arrivalOf(booking), Duration.hours(1))) ||
		DateTime.isLessThan(now, DateTime.subtractDuration(booking.departs, Duration.hours(30)))
	) {
		return Array.empty<Alert>()
	}
	if (Booking.isAnyOf(['train'])(booking)) return trainAlerts(booking)
	return flightAlerts(booking, now)
}
