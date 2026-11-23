import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {Device} from '@deslop/runtime/shared/apns'
import {RpcAuth} from '@deslop/runtime/shared/auth'

import {FlightId, TicketSource, FlightsError, FlightsEvent} from '#services/flights/schema.ts'
import {PushBundle, PushError} from '#services/push/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('flights.events', {error: FlightsError, stream: true, success: FlightsEvent}),
	Rpc.make('flights.save', {error: FlightsError, payload: TicketSource}),
	Rpc.make('flights.remove', {error: FlightsError, payload: Schema.Struct({id: FlightId})}),
	// Asks the provider now, at most once a minute while the flight is tracked.
	Rpc.make('tracking.refresh', {error: FlightsError, payload: Schema.Struct({id: FlightId})}),
	Rpc.make('push.register', {
		error: PushError,
		payload: Device.insert.mapFields(fields => ({...fields, bundle: PushBundle}))
	}),
	Rpc.make('push.start', {error: PushError, payload: Schema.Struct({id: FlightId})})
).middleware(RpcAuth) {}
