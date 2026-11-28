import {Schema, pipe} from 'effect'

import {Model} from 'effect/schema'

import {DateTimeUtcFromFiniteMillis} from '@deslop/runtime/shared/time'

import {DurationFromMinutes, FlightId} from '#flights/contract.ts'
import {Device, PhoneId} from '#push/contract.ts'

export type Tone = typeof Tone.Type
export const Tone = Schema.Literals(['good', 'warn', 'bad', 'info', 'plain'])

// Where the day stands: on the way to the airport, then at the gate, boarding, away from the gate before takeoff, in the air, and landed at its end.
export type FlightPhase = typeof FlightPhase.Type
export const FlightPhase = Schema.Literals([
	'leave',
	'airport',
	'gate',
	'boarding',
	'taxiing',
	'airborne',
	'landed',
	'cancelled',
	'diverted'
])

// The day's bar: the way to the airport, the gate, boarding and the flight.
export type Segment = typeof Segment.Type
export const Segment = Schema.Literals([0, 1, 2, 3])

// What the day's one Live Activity shows, already worded: the widget runtime renders it without logic of its own, and ActivityKit allows 4 KB per update. Two fields never move, what to do on the left and the time left on the right, over the bar and one line of small print.
export type ActivityProps = typeof ActivityProps.Type
export const ActivityProps = Schema.Struct({
	// The deadline the ring and the time left count down to, from `since`; none once nothing is left to wait for.
	deadline: Schema.OptionFromOptionalKey(DateTimeUtcFromFiniteMillis),
	delay: DurationFromMinutes,
	// The island's leading slot: the gate, or a symbol while there is none.
	gate: Schema.OptionFromOptionalKey(Schema.String),
	// The compact and expanded island share these words on the ground.
	island: Schema.optionalKey(
		Schema.Struct({
			detail: Schema.optionalKey(Schema.String),
			footer: Schema.String,
			title: Schema.String,
			value: Schema.String,
			warning: Schema.Boolean
		})
	),
	label: Schema.String,
	note: Schema.String,
	noteTone: Tone,
	noteWas: Schema.OptionFromOptionalKey(Schema.String),
	// A placeholder value, such as a gate not yet posted, drawn faint.
	pending: Schema.Boolean,
	phase: FlightPhase,
	problem: Schema.OptionFromOptionalKey(Schema.String),
	segment: Segment,
	// The bar's current part fills from `segmentSince` to `segmentUntil`.
	segmentSince: DateTimeUtcFromFiniteMillis,
	segmentUntil: DateTimeUtcFromFiniteMillis,
	since: DateTimeUtcFromFiniteMillis,
	small: Schema.String,
	symbol: Schema.Literals([
		'airplane',
		'airplane.arrival',
		'airplane.departure',
		'car.fill',
		'exclamationmark.triangle.fill'
	]),
	// The ring turns the warning colour while the small print names a problem.
	tone: Tone,
	until: Schema.String,
	// What `until` shows in place of a countdown once there is no deadline.
	untilValue: Schema.String,
	value: Schema.String,
	was: Schema.OptionFromOptionalKey(Schema.String)
})

// A day longer than a Live Activity may live gets one activity for its start and another for the rest.
export type Leg = typeof Leg.Type
export const Leg = Schema.Literals(['departure', 'arrival'])

export type ActivityPropsJson = typeof ActivityPropsJson.Type
// The content-state's props, which ActivityKit carries as a JSON string.
export const ActivityPropsJson = Schema.fromJsonString(ActivityProps)

export type ChannelId = typeof ChannelId.Type
export const ChannelId = pipe(Schema.String, Schema.brand('ChannelId'))

// One row of `activities`: a Live Activity the server started for one window of a flight on one app, updated and ended through its broadcast channel.
export class Activity extends Model.Class<Activity>('Activity')({
	bundle: Schema.String,
	channel: ChannelId,
	endedAt: Model.FieldOption(Schema.DateTimeUtcFromMillis),
	flightId: FlightId,
	leg: Leg,
	// The iPhone it was started on, whose alerts it tells.
	phone: PhoneId,
	// What it last showed, so only a change is pushed, and urgently only when its urgency changed.
	props: Model.JsonFromString(ActivityProps),
	// ActivityKit's eight hours count from here.
	startedAt: Schema.DateTimeUtcFromMillis
}) {
	static readonly table = 'activities'
}

// One row of `retirements`: a channel Apple may still hold, written with the change that retired it, or before the start that will use it is sent, and forgotten only once Apple deleted it or answered that it never will, so a restart resumes it.
export class Retirement extends Model.Class<Retirement>('Retirement')({
	bundle: Schema.String,
	channel: ChannelId,
	// What the activity last showed while its end is still to be sent; none once Apple took the end, and for a channel whose start is not saved as an activity.
	props: Model.FieldOption(Model.JsonFromString(ActivityProps)),
	// The epoch for a channel written before its start is sent, which is what holds new starts until Apple deleted it.
	retiredAt: Schema.DateTimeUtcFromMillis
}) {
	static readonly table = 'retirements'
}

export type ShowAction = typeof ShowAction.Type
export const ShowAction = Schema.TaggedUnion({launch: {target: Device}, refresh: {target: Activity}})
