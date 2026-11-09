import {Schema, pipe} from 'effect'

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

export type Device = typeof Device.Type
export const Device = Schema.Struct({bundle: Bundle, kind: Schema.Literals(['alert', 'start']), token: ApnsToken})

export type ActivityClaim = typeof ActivityClaim.Type
export const ActivityClaim = Schema.Struct({bookingId: BookingId, bundle: Bundle, leg: Leg})

export type ActivityToken = typeof ActivityToken.Type
export const ActivityToken = Schema.Struct({...ActivityClaim.fields, token: ApnsToken})

export type ActivityRecord = typeof ActivityRecord.Type
export const ActivityRecord = Schema.Struct({
	bookingId: BookingId,
	bundle: Bundle,
	channel: Schema.optionalKey(Schema.String),
	claimedAt: Schema.Finite,
	endedAt: Schema.optionalKey(Schema.Finite),
	leg: Leg,
	// The JSON last shown, so only a change is pushed.
	props: Schema.optionalKey(Schema.String),
	token: Schema.optionalKey(ApnsToken)
})

export type PushState = typeof PushState.Type
export const PushState = Schema.Struct({
	activities: Schema.Array(ActivityRecord),
	devices: Schema.Array(Device),
	sent: Schema.Record(Schema.String, Schema.Array(Schema.String))
})

export type ApnsReason = typeof ApnsReason.Type
export const ApnsReason = Schema.Struct({reason: Schema.String})
