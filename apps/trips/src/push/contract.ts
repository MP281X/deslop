import {Schema, pipe} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'
import {Model} from 'effect/schema'

import {ApnsToken, Device as ApnsDevice} from '@deslop/runtime/shared/apns'
import {RpcAuth} from '@deslop/runtime/shared/auth'

import {FlightId} from '#flights/contract.ts'

export class PushError extends Schema.TaggedError<PushError>()('PushError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export type PushBundle = typeof PushBundle.Type
// The release app, on Apple's production push service, and the Simulator build, on its sandbox; the server pushes to no other app.
export const PushBundle = Schema.Literals(['xyz.mp281x.trips', 'xyz.mp281x.trips.dev'])

export type PhoneId = typeof PhoneId.Type
// The iPhone a token belongs to, as iOS names it for this developer's apps: a Live Activity tells its changes only to the phone it runs on.
export const PhoneId = pipe(Schema.NonEmptyString, Schema.brand('PhoneId'))

// One row of `devices`: an alert or push-to-start token of one iPhone's app.
export class Device extends Model.Class<Device>('Device')({...Model.fields(ApnsDevice), phone: PhoneId}) {
	static readonly table = 'devices'
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

export const PushRpcs = RpcGroup.make(
	Rpc.make('push.register', {
		error: PushError,
		payload: Device.insert.mapFields(fields => ({...fields, bundle: PushBundle}))
	})
).middleware(RpcAuth)
