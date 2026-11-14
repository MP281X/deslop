import {DateTime, Duration, Number, Option, Schema} from 'effect'
import type {Record} from 'effect'

import {ProblemStatus} from '@deslop/components-mobile/status-dot'
import {colors, hues} from '@deslop/components-mobile/theme'
import {weekdayOf} from '@deslop/runtime/shared/format'

import {clockAt, departureOf, labelled} from '#services/bookings/lib/utils.ts'
import {Tone} from '#services/bookings/schema.ts'
import type {Booking, Flight, FlightTracking, Train, TrainTracking} from '#services/bookings/schema.ts'
import {isStale} from '#services/tracking/lib/utils.ts'

// The day where the trip happens, in that place's zone.
export function dayAt(time: DateTime.Utc, timeZone: string) {
	return weekdayOf(DateTime.makeZonedUnsafe(time, {timeZone}))
}

export function daysUntil(time: DateTime.Utc, now: DateTime.Utc, timeZone: string) {
	function day(at: DateTime.Utc) {
		return DateTime.startOf(DateTime.makeZonedUnsafe(at, {timeZone}), 'day')
	}
	return Number.round(Duration.toDays(DateTime.distance(day(now), day(time))), 0)
}

export const primary = hues.orange

export const tones = {
	bad: colors.destructive,
	good: primary,
	info: primary,
	plain: colors.mutedForeground,
	warn: colors.warning
} satisfies Record.ReadonlyRecord<Tone, unknown>

// Only a problem's dot carries its words; a healthy status shows where it leaves from.
type StatusTone = typeof StatusTone.Type
const StatusTone = Tone.pick(['good', 'info', 'plain'])
type ProblemTone = typeof ProblemTone.Type
const ProblemTone = Tone.pick(['bad', 'warn'])

export type Status = typeof Status.Type
const Status = Schema.TaggedUnion({
	Problem: {label: Schema.String, tone: ProblemTone, where: Schema.Option(Schema.String)},
	Status: {tone: StatusTone, where: Schema.Option(Schema.String)}
})

type Problem = typeof Problem.Type
const Problem = Schema.Struct({label: Schema.String, status: ProblemStatus, tone: ProblemTone})

function statusLine(tone: StatusTone, where: Option.Option<string>) {
	return {_tag: 'Status' as const, tone, where}
}

function problemLine(label: string, tone: ProblemTone, where: Option.Option<string>) {
	return {_tag: 'Problem' as const, label, tone, where}
}

function platformOf(live: TrainTracking) {
	if (live.state === 'departed' || live.state === 'arrived') {
		return labelled('Platform', live.arrivalPlatform)
	}
	return labelled('Platform', live.departurePlatform)
}

function trainStatus(train: Train, now: DateTime.Utc) {
	if (train.operator !== 'trenitalia') return statusLine('plain', Option.none())
	return Option.match(train.live, {
		onNone: () => statusLine('plain', Option.none()),
		onSome: live => {
			if (isStale(train, now)) {
				return problemLine(`Updated ${clockAt(live.checkedAt, train.from.timeZone)}`, 'warn', platformOf(live))
			}
			if (live.state === 'arrived') return statusLine('plain', platformOf(live))
			if (Duration.isGreaterThanOrEqualTo(live.delayMinutes, Duration.minutes(5))) {
				return problemLine(`+${Duration.toMinutes(live.delayMinutes)} min`, 'warn', platformOf(live))
			}
			return statusLine('good', platformOf(live))
		}
	})
}

function gateOf(live: FlightTracking) {
	return Option.orElse(labelled('Gate', live.departureGate), () => labelled('Terminal', live.departureTerminal))
}

function flightStatus(flight: Flight, now: DateTime.Utc) {
	const delay = Number.round(Duration.toMinutes(DateTime.distance(flight.departs, departureOf(flight))), 0)
	return Option.match(flight.live, {
		onNone: () => statusLine('plain', Option.none()),
		onSome: live => {
			if (live.state === 'cancelled') return problemLine('Cancelled', 'bad', Option.none())
			if (live.state === 'diverted') return problemLine('Diverted', 'bad', Option.none())
			if (isStale(flight, now)) {
				return problemLine(`Updated ${clockAt(live.checkedAt, flight.from.timeZone)}`, 'warn', gateOf(live))
			}
			if (live.state === 'arrived' || live.state === 'landed') {
				return statusLine('good', labelled('Belt', live.belt))
			}
			if (live.state === 'airborne' || live.state === 'departed') return statusLine('info', Option.none())
			if (delay >= 15) return problemLine(`+${delay} min`, 'warn', gateOf(live))
			return statusLine('good', gateOf(live))
		}
	})
}

// Where the journey stands, with the gate or platform; old live data says when it was read rather than look current.
export function statusOf(booking: Booking, now: DateTime.Utc) {
	if (booking.status === 'cancelled') return problemLine('Cancelled', 'bad', Option.none())
	if (booking._tag === 'stay') return statusLine('plain', Option.none())
	if (booking._tag === 'train') return trainStatus(booking, now)
	return flightStatus(booking, now)
}

// Only a problem gets a dot: a delay, a cancellation, or a live answer that went stale with its age.
export function problemOf(booking: Booking, status: Status, now: DateTime.Utc) {
	if (booking._tag !== 'stay' && isStale(booking, now)) {
		return Option.map<FlightTracking | TrainTracking, {label: string; status: 'warning'; tone: 'warn'}>(
			booking.live,
			live => ({
				label: `${Number.max(0, Math.floor(Duration.toMinutes(DateTime.distance(live.checkedAt, now))))}m`,
				status: 'warning' as const,
				tone: 'warn' as const
			})
		)
	}
	if (status.tone === 'bad') {
		return Option.some({label: status.label, status: 'error' as const, tone: 'bad' as const})
	}
	if (status.tone === 'warn') {
		return Option.some({label: status.label, status: 'warning' as const, tone: 'warn' as const})
	}
	return Option.none<Problem>()
}
