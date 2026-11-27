import {Route} from '@effect/ui'

import {Schema} from 'effect'

import {Pane} from '@deslop/ui/split'

import {FlightId} from '#contracts'

const search = {pane: Schema.optionalKey(Pane)}

export const TripsRoute = Route.union({
	Day: Route.make('/day/:id', {params: {id: FlightId}, search}),
	Flight: Route.make('/flight/:id', {params: {id: FlightId}, search}),
	Home: Route.make('/', {search}),
	NotFound: Route.make('/*')
})
