import {Command, Route} from '@effect/ui'

import {Schema} from 'effect'

import {backOrHome} from '@deslop/components/navigation'

import {FlightId} from '#contracts'

const search = {pane: Schema.optionalKey(Schema.Literals(['list', 'detail']))}
export type TripsRoute = typeof TripsRoute.Type
export const TripsRoute = Route.union({
	Day: Route.make('/day/:id', {params: {id: FlightId}, search}),
	Flight: Route.make('/flight/:id', {params: {id: FlightId}, search}),
	Home: Route.make('/', {search}),
	NotFound: Route.make('/*')
})

const home = TripsRoute.Home({search: {}})
export function flightRoute(id: FlightId) {
	return TripsRoute.Flight({params: {id}, search: {}})
}

export class CloseFlight extends Command.Service<CloseFlight>()('Trips/CloseFlight', {args: {}}) {
	static readonly layer = this.toLayer(backOrHome(home))
}
