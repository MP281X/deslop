import {Schema, pipe} from 'effect'

import {ActivityProps, BookingId, Leg} from '#services/bookings/schema.ts'

// The content-state's props, which expo-widgets reads as a JSON string.
export type ActivityPropsJson = typeof ActivityPropsJson.Type
export const ActivityPropsJson = Schema.fromJsonString(ActivityProps)

// A provider token's header and claims.
export type JwtPart = typeof JwtPart.Type
export const JwtPart = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Finite])))

export class PushError extends Schema.TaggedError<PushError>()('PushError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

// The release app and the Simulator build; the server pushes to no other app.
export type Bundle = typeof Bundle.Type
export const Bundle = Schema.Literals(['xyz.mp281x.trips', 'xyz.mp281x.trips.dev'])

// The APNs environment the signed app reports, which picks Apple's sandbox or production host.
export type ApnsEnvironment = typeof ApnsEnvironment.Type
export const ApnsEnvironment = Schema.Literals(['development', 'production'])

export type ApnsToken = typeof ApnsToken.Type
export const ApnsToken = pipe(Schema.String, Schema.check(Schema.isPattern(/^[0-9a-f]{32,512}$/iu)))

// A device token for ordinary notifications, or the token that lets the server start a Live Activity.
export type Device = typeof Device.Type
export const Device = Schema.Struct({
	bundle: Bundle,
	environment: ApnsEnvironment,
	kind: Schema.Literals(['alert', 'start']),
	token: ApnsToken
})

export type ActivityClaim = typeof ActivityClaim.Type
export const ActivityClaim = Schema.Struct({
	bookingId: BookingId,
	bundle: Bundle,
	environment: ApnsEnvironment,
	leg: Leg
})

export type ActivityToken = typeof ActivityToken.Type
export const ActivityToken = Schema.Struct({...ActivityClaim.fields, token: ApnsToken})

// One Live Activity of a booking's leg: started by the app, which sends its token, or by the server through a channel.
export type ActivityRecord = typeof ActivityRecord.Type
export const ActivityRecord = Schema.Struct({
	bookingId: BookingId,
	bundle: Bundle,
	channel: Schema.optionalKey(Schema.String),
	claimedAt: Schema.Finite,
	endedAt: Schema.optionalKey(Schema.Finite),
	environment: ApnsEnvironment,
	leg: Leg,
	// The JSON last shown, so only a change is pushed.
	props: Schema.optionalKey(Schema.String),
	token: Schema.optionalKey(ApnsToken)
})

export type PushState = typeof PushState.Type
export const PushState = Schema.Struct({
	activities: Schema.Array(ActivityRecord),
	devices: Schema.Array(Device),
	// The alert keys each booking already announced.
	sent: Schema.Record(Schema.String, Schema.Array(Schema.String))
})

export type ApnsReason = typeof ApnsReason.Type
export const ApnsReason = Schema.Struct({reason: Schema.String})
