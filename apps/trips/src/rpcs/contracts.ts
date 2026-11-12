import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {RpcAuth} from '@deslop/runtime/shared/auth'

import {BookingId, BookingSource, BookingsError, BookingsEvent} from '#services/bookings/schema.ts'
import {Device, PushError} from '#services/push/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('bookings.events', {error: BookingsError, stream: true, success: BookingsEvent}),
	Rpc.make('bookings.save', {error: BookingsError, payload: BookingSource}),
	Rpc.make('bookings.remove', {error: BookingsError, payload: Schema.Struct({id: BookingId})}),
	// Asks the provider now, at most once a minute while the journey is tracked.
	Rpc.make('tracking.refresh', {error: BookingsError, payload: Schema.Struct({id: BookingId})}),
	Rpc.make('push.register', {error: PushError, payload: Device.insert})
).middleware(RpcAuth) {}
