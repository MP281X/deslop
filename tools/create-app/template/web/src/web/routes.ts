import {Route} from '@effect/ui'

export const AppRoute = Route.union({Home: Route.make('/'), NotFound: Route.make('/*')})
