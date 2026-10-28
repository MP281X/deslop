import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {RpcAuth} from '@deslop/runtime/auth/utils'

import {Booking, BookingId, BookingSource, BookingsError, BookingsEvent} from '#services/bookings/schema.ts'
import {ActivityClaim, ActivityToken, Device, PushError} from '#services/push/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('bookings.watch', {error: BookingsError, stream: true, success: BookingsEvent}),
	Rpc.make('bookings.save', {error: BookingsError, payload: BookingSource, success: Schema.Array(Booking)}),
	Rpc.make('bookings.remove', {error: BookingsError, payload: Schema.Struct({id: BookingId})}),
	Rpc.make('bookings.restore', {error: BookingsError, payload: Booking}),
	// Asks the provider now, at most once a minute while the journey is tracked.
	Rpc.make('bookings.refresh', {error: BookingsError, payload: Schema.Struct({id: BookingId})}),
	Rpc.make('devices.register', {error: PushError, payload: Device}),
	// Whether the app may start a leg's Live Activity itself; the server starts the ones nobody claimed.
	Rpc.make('activities.claim', {error: PushError, payload: ActivityClaim, success: Schema.Boolean}),
	Rpc.make('activities.register', {error: PushError, payload: ActivityToken})
).middleware(RpcAuth) {}
