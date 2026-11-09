import {Array, Option, Record, Result, String} from 'effect'

import {ACTIVITY_LIFETIME, activeWindow, DAY, MINUTE} from '#services/bookings/lib/utils.ts'
import type {Alert} from '#services/bookings/lib/utils.ts'
import type {BookingList, Flight, Leg, Train} from '#services/bookings/schema.ts'
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
