import {Route} from '@effect/ui'

import {FlightId} from '#contracts'

export const TripsRoute = Route.union({
	Day: Route.make('/day/:id', {params: {id: FlightId}}),
	Flight: Route.make('/flight/:id', {params: {id: FlightId}}),
	Home: Route.make('/'),
	NotFound: Route.make('/*')
})
