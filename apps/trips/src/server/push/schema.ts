import {Schema, pipe} from 'effect'

import {Model} from 'effect/schema'

import {ApnsToken} from '@deslop/runtime/shared/apns'

import {ActivityProps, Device, FlightId, PhoneId} from '#contracts'

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

// One row of `sent_alerts`: an alert sent for a flight, so each is sent once; the latest of a category tells a change back from a repeat.
export type AlertCategory = typeof AlertCategory.Type
export const AlertCategory = Schema.Literals([
	'cancelled',
	'diverted',
	'boarding',
	'gate',
	'delay',
	'checkin',
	'closing',
	'plan',
	'leave',
	'connection'
])

export class SentAlert extends Model.Class<SentAlert>('SentAlert')({
	category: AlertCategory,
	flightId: FlightId,
	sentAt: Schema.DateTimeUtcFromMillis,
	value: Model.FieldOption(Schema.String)
}) {
	static readonly table = 'sent_alerts'
}

// Terminal device answers, including partial rounds; retained until the flight leaves so delay steps never repeat.
export class AlertDelivery extends Model.Class<AlertDelivery>('Delivery')({
	...Model.fields(SentAlert),
	token: Model.Sensitive(Schema.RedactedFromValue(ApnsToken))
}) {
	static readonly table = 'deliveries'
}

export type ShowAction = typeof ShowAction.Type
export const ShowAction = Schema.TaggedUnion({launch: {target: Device}, refresh: {target: Activity}})
