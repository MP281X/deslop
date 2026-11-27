import {Command, Route, Router} from '@effect/ui'

import {Effect, Schema} from 'effect'

import {FlightId} from '#contracts'

const search = {pane: Schema.optionalKey(Schema.Literals(['list', 'detail']))}
export type TripsRoute = typeof TripsRoute.Type
export const TripsRoute = Route.union({
	Day: Route.make('/day/:id', {params: {id: FlightId}, search}),
	Flight: Route.make('/flight/:id', {params: {id: FlightId}, search}),
	Home: Route.make('/', {search}),
	NotFound: Route.make('/*')
})

export const home = TripsRoute.Home({search: {}})
export const flightRoute = (id: FlightId) => TripsRoute.Flight({params: {id}, search: {}})

export class CloseFlight extends Command.Service<CloseFlight>()('Trips/CloseFlight', {args: {}}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Router.Router,
			router => () =>
				Effect.suspend(() => {
					if (router.location().action === 'initial') return router.replace(home)
					return router.back
				})
		)
	)
}
