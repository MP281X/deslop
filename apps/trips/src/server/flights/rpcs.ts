import {Effect} from 'effect'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {FlightRpcs} from '#contracts'

import {Flights} from './service.ts'

export const flightHandlers = FlightRpcs.toLayer(
	Effect.map(Flights, flights => ({
		'flights.events': () => flights.events,
		'flights.remove': request => flights.remove(request.id),
		'flights.save': request => Effect.flatMap(CurrentUser, user => flights.save(user.id, request)),
		'travel.list': () => flights.travel,
		'travel.set': request => flights.setTravel(request)
	}))
)
