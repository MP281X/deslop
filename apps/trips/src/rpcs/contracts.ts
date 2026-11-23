import {Schema} from 'effect'

import {Rpc, RpcGroup} from 'effect/rpc'

import {Device} from '@deslop/runtime/shared/apns'
import {RpcAuth} from '@deslop/runtime/shared/auth'

import {FlightId, TicketSource, FlightsError, FlightsEvent, TravelTime} from '#services/flights/schema.ts'
import {PushBundle, PushError} from '#services/push/schema.ts'

export class RpcContracts extends RpcGroup.make(
	Rpc.make('flights.events', {error: FlightsError, stream: true, success: FlightsEvent}),
	Rpc.make('flights.save', {error: FlightsError, payload: TicketSource}),
	Rpc.make('flights.remove', {error: FlightsError, payload: Schema.Struct({id: FlightId})}),
	// The trip from home to each airport, saved once per airport.
	Rpc.make('travel.list', {error: FlightsError, success: Schema.Array(TravelTime)}),
	Rpc.make('travel.set', {error: FlightsError, payload: TravelTime}),
	// Asks the provider now, at most once a minute while the flight is tracked.
	Rpc.make('tracking.refresh', {error: FlightsError, payload: Schema.Struct({id: FlightId})}),
	Rpc.make('push.register', {
		error: PushError,
		payload: Device.insert.mapFields(fields => ({...fields, bundle: PushBundle}))
	})
).middleware(RpcAuth) {}
