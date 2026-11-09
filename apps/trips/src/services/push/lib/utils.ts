import {Array, Number, Option, Record, Result, String} from 'effect'

import {
	ACTIVITY_LIFETIME,
	activeWindow,
	arrivalOf,
	clockAt,
	DAY,
	departureOf,
	HOUR,
	labelled,
	line,
	MINUTE,
	routeOf,
	titleOf
} from '#services/bookings/lib/utils.ts'
import type {Booking, BookingList, Flight, Leg, Train} from '#services/bookings/schema.ts'
import type {ActivityRecord, Device, PushState} from '#services/push/schema.ts'

export type Span = {end: number; start: number}
type ShowAction = {_tag: 'launch'; target: Device} | {_tag: 'refresh'; target: ActivityRecord}

export function holds(record: ActivityRecord, window: Span, now: number) {
	if (record.claimedAt + ACTIVITY_LIFETIME < window.end) return false
	if (record.endedAt !== undefined) return record.endedAt >= window.start
	return record.token !== undefined || record.channel !== undefined || now - record.claimedAt < 2 * MINUTE
}

export function alertKey(alert: Alert) {
	if (alert.value === undefined) return alert.category
	return `${alert.category}:${alert.value}`
}

export function announced(sent: PushState['sent'][string], alert: Alert) {
	if (alert.value === undefined || alert.category === 'delay') return Array.contains(sent, alertKey(alert))
	return Option.exists(
		Array.findLast(sent, found => String.startsWith(`${alert.category}:`)(found)),
		found => found === alertKey(alert)
	)
}

export function showPlan(current: PushState, journey: Flight | Train, window: Span & {leg: Leg}, now: number) {
	const starters = Array.filter(current.devices, device => device.kind === 'start')
	const records = Array.filter(
		current.activities,
		item => item.bookingId === journey.id && item.leg === window.leg && holds(item, window, now)
	)
	const startersByBundle = Array.groupBy(starters, device => device.bundle)
	const recordsByBundle = Array.groupBy(records, item => item.bundle)
	return Array.filterMap(
		Array.dedupe([...Array.map(starters, device => device.bundle), ...Array.map(records, item => item.bundle)]),
		bundle =>
			Option.match(Array.head(recordsByBundle[bundle] ?? []), {
				onNone: () =>
					Option.match(Array.head(startersByBundle[bundle] ?? []), {
						onNone: () => Result.failVoid,
						onSome: target => Result.succeed<ShowAction>({_tag: 'launch', target})
					}),
				onSome: target => {
					if (target.endedAt !== undefined || (target.token === undefined && target.channel === undefined)) {
						return Result.failVoid
					}
					return Result.succeed<ShowAction>({_tag: 'refresh', target})
				}
			})
	)
}

export function expiredActivities(current: PushState, all: BookingList, now: number) {
	const byId = Array.groupBy(all, booking => booking.id)
	return Array.filter(
		current.activities,
		record =>
			record.endedAt === undefined &&
			!Option.exists(Array.head(byId[record.bookingId] ?? []), found =>
				Option.exists(activeWindow(found, now), window => window.leg === record.leg)
			)
	)
}

export function retainPushState(current: PushState, all: BookingList, now: number) {
	const byId = Array.groupBy(all, booking => booking.id)
	return {
		...current,
		activities: Array.filter(
			current.activities,
			record => record.endedAt === undefined || now - record.endedAt < 2 * DAY
		),
		sent: Record.filter(current.sent, (_keys, id) => Record.has(byId, id))
	} satisfies PushState
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
		Option.map(
			// Worth a notification only while the train is still to board.
			Option.filter(Option.fromUndefinedOr(train.live?.departurePlatform), () => train.live?.state === 'scheduled'),
			platform =>
				({
					body: line([Option.some(`${train.from.name} at ${departure}`), labelled('coach', train.coach)]),
					category: 'platform',
					title: `${title} · Platform ${platform}`,
					value: platform
				}) satisfies Alert
		),
		Option.map(
			Option.filter(Option.fromUndefinedOr(train.live?.delayMinutes), delay => delay >= 10),
			delay =>
				({
					body: `Now leaves ${train.from.name} at ${departure}`,
					category: 'delay',
					title: `${title} is ${delay} min late`,
					value: `${Number.round(delay / 10, 0) * 10}`
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
				category: 'cancelled',
				title: `${title} is cancelled`
			}),
			() => cancelled
		),
		Option.filter(
			Option.some<Alert>({body: routeOf(flight), category: 'diverted', title: `${title} is diverted`}),
			() => flight.live?.state === 'diverted'
		),
		Option.map(
			Option.fromUndefinedOr(flight.live?.departureGate),
			gate =>
				({
					body: Option.getOrElse(labelled('Changed from', flight.live?.previousGate), () =>
						line([Option.some(`Departs ${departure}`), labelled('Terminal', flight.live?.departureTerminal)])
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
		Option.map<number, Alert>(
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
					category: 'boarding',
					title: `${title} boards at ${clockAt(at, flight.from.timeZone)}`
				}) satisfies Alert
		),
		Option.map(
			Option.fromUndefinedOr(flight.live?.belt),
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
