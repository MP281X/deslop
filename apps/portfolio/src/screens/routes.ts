import {Route} from '@effect/ui'

export const PortfolioRoute = Route.union({Cv: Route.make('/cv'), Home: Route.make('/')})
