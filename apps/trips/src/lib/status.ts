import {Boolean, DateTime, Duration, Number, Option} from 'effect'
import type {Record} from 'effect'

import {colors, hues} from '@deslop/components-mobile/theme'

import {clockAt, DAY, departureOf, labelled, MINUTE} from '#services/bookings/lib/utils.ts'
import type {Booking, Flight, FlightTracking, Stay, Tone, Train, TrainTracking} from '#services/bookings/schema.ts'
import {isStale} from '#services/tracking/lib/utils.ts'

export function dayAt(time: number, timeZone: string) {
	return DateTime.format(DateTime.makeUnsafe(time), {day: 'numeric', month: 'short', timeZone, weekday: 'short'})
}

export function daysUntil(time: number, now: number, timeZone: string) {
	function day(at: number) {
		return DateTime.startOf(DateTime.makeZonedUnsafe(at, {timeZone}), 'day')
	}
	return Number.round(Duration.toMillis(DateTime.distance(day(now), day(time))) / DAY, 0)
}

export const primary = hues.orange

export const tones = {
	bad: colors.destructive,
	good: primary,
	info: primary,
	plain: colors.mutedForeground,
	warn: colors.warning
} satisfies Record.ReadonlyRecord<Tone, unknown>

export type Where = {text: string; tone: Tone}

// Only a problem's dot carries its words; a healthy status shows where it leaves from.
export type Status =
	| {label: string; tone: 'bad' | 'warn'; where: Option.Option<Where>}
	| {tone: 'good' | 'info' | 'plain'; where: Option.Option<Where>}

function statusLine(tone: 'good' | 'info' | 'plain', where: Option.Option<Where>) {
	return {tone, where}
}

function problemLine(label: string, tone: 'bad' | 'warn', where: Option.Option<Where>) {
	return {label, tone, where}
}

function whereOf(text: Option.Option<string>, changed: boolean) {
	return Option.map(
		text,
		found =>
			({text: found, tone: Boolean.match(changed, {onFalse: () => 'plain', onTrue: () => 'warn'})}) satisfies Where
	)
}

function stayStatus(stay: Stay, now: number) {
	if (now < stay.checkIn) return statusLine('plain', Option.none())
	if (now < stay.checkOut) return statusLine('good', Option.none())
	return statusLine('plain', Option.none())
}

function platformOf(live: TrainTracking) {
	if (live.state === 'departed' || live.state === 'arrived') {
		return whereOf(labelled('Platform', Option.fromUndefinedOr(live.arrivalPlatform)), false)
	}
	return whereOf(
		labelled('Platform', Option.fromUndefinedOr(live.departurePlatform)),
		live.departurePlatformPlanned !== undefined && live.departurePlatform !== live.departurePlatformPlanned
	)
}

function trainStatus(train: Train, now: number) {
	if (train.operator !== 'trenitalia') return statusLine('plain', Option.none())
	return Option.match(train.live, {
		onNone: () => statusLine('plain', Option.none()),
		onSome: live => {
			if (isStale(train, now)) {
				return problemLine(`Updated ${clockAt(live.checkedAt, train.from.timeZone)}`, 'warn', platformOf(live))
			}
			if (live.state === 'arrived') return statusLine('plain', platformOf(live))
			if (live.delayMinutes >= 5) return problemLine(`+${live.delayMinutes} min`, 'warn', platformOf(live))
			return statusLine('good', platformOf(live))
		}
	})
}

function gateOf(live: FlightTracking) {
	return whereOf(
		Option.orElse(labelled('Gate', Option.fromUndefinedOr(live.departureGate)), () =>
			labelled('Terminal', Option.fromUndefinedOr(live.departureTerminal))
		),
		live.previousGate !== undefined
	)
}

function flightStatus(flight: Flight, now: number) {
	const delay = Number.round((departureOf(flight) - flight.departs) / MINUTE, 0)
	return Option.match(flight.live, {
		onNone: () => statusLine('plain', Option.none()),
		onSome: live => {
			if (live.state === 'cancelled') return problemLine('Cancelled', 'bad', Option.none())
			if (live.state === 'diverted') return problemLine('Diverted', 'bad', Option.none())
			if (isStale(flight, now)) {
				return problemLine(`Updated ${clockAt(live.checkedAt, flight.from.timeZone)}`, 'warn', gateOf(live))
			}
			if (live.state === 'arrived' || live.state === 'landed') {
				return statusLine('good', whereOf(labelled('Belt', Option.fromUndefinedOr(live.belt)), false))
			}
			if (live.state === 'airborne' || live.state === 'departed') return statusLine('info', Option.none())
			if (delay >= 15) return problemLine(`+${delay} min`, 'warn', gateOf(live))
			return statusLine('good', gateOf(live))
		}
	})
}

// Where the journey stands, with the gate or platform; old live data says when it was read rather than look current.
export function statusOf(booking: Booking, now: number) {
	if (booking.status === 'cancelled') return problemLine('Cancelled', 'bad', Option.none())
	if (booking._tag === 'stay') return stayStatus(booking, now)
	if (booking._tag === 'train') return trainStatus(booking, now)
	return flightStatus(booking, now)
}

// Only a problem gets a dot: a delay, a cancellation, or a live answer that went stale with its age.
export function problemOf(booking: Booking, status: Status, now: number) {
	if (booking._tag !== 'stay' && isStale(booking, now)) {
		return Option.map(booking.live, live => ({
			label: `${Number.max(0, Math.floor((now - live.checkedAt) / MINUTE))}m`,
			status: 'warning' as const,
			tone: 'warn' as const
		}))
	}
	if (status.tone === 'bad') {
		return Option.some({label: status.label, status: 'error' as const, tone: 'bad' as const})
	}
	if (status.tone === 'warn') {
		return Option.some({label: status.label, status: 'warning' as const, tone: 'warn' as const})
	}
	return Option.none<{label: string; status: 'error' | 'warning'; tone: 'bad' | 'warn'}>()
}
