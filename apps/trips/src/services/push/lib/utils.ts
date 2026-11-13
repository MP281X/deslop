import {Array, Number, Option, Result, String, pipe} from 'effect'

import {
	ACTIVITY_LIFETIME,
	activeWindow,
	arrivalOf,
	clockAt,
	departureOf,
	HOUR,
	labelled,
	line,
	MINUTE,
	routeOf,
	titleOf
} from '#services/bookings/lib/utils.ts'
import type {Booking, BookingList, Flight, Leg, Train} from '#services/bookings/schema.ts'
import type {Activity, Device} from '#services/push/schema.ts'

export type Span = {end: number; start: number}
type ShowAction = {_tag: 'launch'; target: Device} | {_tag: 'refresh'; target: Activity}

// An activity covers the window while ActivityKit keeps it alive, unless it ended before the window began.
export function holds(activity: Activity, window: Span) {
	if (activity.startedAt + ACTIVITY_LIFETIME < window.end) return false
	return Option.match(activity.endedAt, {onNone: () => true, onSome: ended => ended >= window.start})
}

export function alertKey(alert: Alert) {
	if (alert.value === undefined) return alert.category
	return `${alert.category}:${alert.value}`
}

// `sent` holds the keys sent for the booking, oldest first.
export function announced(sent: readonly string[], alert: Alert) {
	if (alert.value === undefined || alert.category === 'delay') return Array.contains(sent, alertKey(alert))
	return pipe(sent, Array.findLast(found => String.startsWith(`${alert.category}:`)(found)), Option.exists(found => found === alertKey(alert)))
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
						onSome: target => Result.succeed<ShowAction>({_tag: 'launch', target})
					}),
				onSome: target => {
					if (Option.isSome(target.endedAt)) return Result.failVoid
					return Result.succeed<ShowAction>({_tag: 'refresh', target})
				}
			})
	)
}

// Running activities whose leg is no longer in its window, or whose booking is gone.
export function expiredActivities(activities: readonly Activity[], all: BookingList, now: number) {
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
	if (journey._tag === 'flight') {
		return {
			body: line([
				Option.some(routeOf(journey)),
				labelled(
					'Gate',
					Option.flatMapNullishOr(journey.live, live => live.departureGate)
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
				Option.flatMapNullishOr(journey.live, live => live.departurePlatform)
			)
		]),
		title: titleOf(journey)
	}
}

export type Alert = {
	body: string
	title: string
	category: 'cancelled' | 'diverted' | 'boarding' | 'gate' | 'platform' | 'delay' | 'belt'
	value?: string
}

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
		pipe(train.live, Option.filter(live => live.state === 'scheduled'), Option.flatMapNullishOr(live => live.departurePlatform), Option.map(platform =>
				({
					body: line([Option.some(`${train.from.name} at ${departure}`), labelled('coach', train.coach)]),
					category: 'platform',
					title: `${title} · Platform ${platform}`,
					value: platform
				}) satisfies Alert)),
		pipe(train.live, Option.map(live => live.delayMinutes), Option.filter(delay => delay >= 10), Option.map(delay =>
				({
					body: `Now leaves ${train.from.name} at ${departure}`,
					category: 'delay',
					title: `${title} is ${delay} min late`,
					value: `${Number.round(delay / 10, 0) * 10}`
				}) satisfies Alert))
	])
}

function flightAlerts(flight: Flight, now: number) {
	const title = titleOf(flight)
	const departure = clockAt(departureOf(flight), flight.from.timeZone)
	const delay = Number.round((departureOf(flight) - flight.departs) / MINUTE, 0)
	const live = Option.getOrUndefined(flight.live)
	const cancelled = flight.status === 'cancelled' || live?.state === 'cancelled'
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
			() => live?.state === 'diverted'
		),
		Option.map(
			Option.fromUndefinedOr(live?.departureGate),
			gate =>
				({
					body: Option.getOrElse(labelled('Changed from', Option.fromUndefinedOr(live?.previousGate)), () =>
						line([
							Option.some(`Departs ${departure}`),
							labelled('Terminal', Option.fromUndefinedOr(live?.departureTerminal))
						])
					),
					category: 'gate',
					title: `${title} · Gate ${gate}`,
					value: gate
				}) satisfies Alert
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
		pipe(flight.boardingAt, Option.filter(at => now >= at - 10 * MINUTE && now < departureOf(flight)), Option.map<number, Alert>(at =>
				({
					body: line([
						Option.orElseSome(labelled('Gate', Option.fromUndefinedOr(live?.departureGate)), () => 'Check the gate'),
						labelled('group', flight.boardingGroup)
					]),
					category: 'boarding',
					title: `${title} boards at ${clockAt(at, flight.from.timeZone)}`
				}) satisfies Alert)),
		Option.map(
			Option.fromUndefinedOr(live?.belt),
			belt =>
				({body: flight.to.name, category: 'belt', title: `${title} bags on belt ${belt}`, value: belt}) satisfies Alert
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
