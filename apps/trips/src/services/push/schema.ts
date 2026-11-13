import {Schema, pipe} from 'effect'

import {Model} from 'effect/schema'

import {ActivityProps, BookingId, Leg} from '#services/bookings/schema.ts'

// The content-state's props, which expo-widgets reads as a JSON string.
export type ActivityPropsJson = typeof ActivityPropsJson.Type
export const ActivityPropsJson = Schema.fromJsonString(ActivityProps)

// The provider token's claims as JSON; APNs takes at most an hour.
export type JwtClaims = typeof JwtClaims.Type
export const JwtClaims = Schema.fromJsonString(Schema.Struct({iat: Schema.Finite, iss: Schema.String}))

export class PushError extends Schema.TaggedError<PushError>()('PushError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

// The release app, on Apple's production push service, and the Simulator build, on its sandbox; the server pushes to no other app.
export type Bundle = typeof Bundle.Type
export const Bundle = Schema.Literals(['xyz.mp281x.trips', 'xyz.mp281x.trips.dev'])

export type ApnsToken = typeof ApnsToken.Type
export const ApnsToken = pipe(Schema.String, Schema.check(Schema.isPattern(/^[0-9a-f]{32,512}$/iu)))

// One row of `devices`, and what the phone registers: one token per kind and app, a new one replacing the one it rotated from.
export class Device extends Model.Class<Device>('Device')({
	bundle: Bundle,
	kind: Schema.Literals(['alert', 'start']),
	// A push token is a secret: it never leaves the server and prints redacted.
	token: Model.Sensitive(Schema.RedactedFromValue(ApnsToken))
}) {
	static readonly table = 'devices'
}

// One row of `activities`: a Live Activity the server started for one leg of a journey on one app, updated and ended through its broadcast channel.
export class Activity extends Model.Class<Activity>('Activity')({
	bookingId: BookingId,
	bundle: Bundle,
	channel: Schema.String,
	endedAt: Model.FieldOption(Schema.Int),
	leg: Leg,
	// What it last showed, so only a change is pushed, and urgently only when its urgency changed.
	props: Model.JsonFromString(ActivityProps),
	// ActivityKit's eight hours count from here.
	startedAt: Schema.Int
}) {
	static readonly table = 'activities'
}

// One row of `sent_alerts`: an alert sent for a booking, so each is sent once; the latest of a category tells a change back from a repeat.
export class SentAlert extends Model.Class<SentAlert>('SentAlert')({
	bookingId: BookingId,
	key: Schema.String,
	sentAt: Schema.Int
}) {
	static readonly table = 'sent_alerts'
}

export type ApnsReason = typeof ApnsReason.Type
export const ApnsReason = Schema.Struct({reason: Schema.String})
