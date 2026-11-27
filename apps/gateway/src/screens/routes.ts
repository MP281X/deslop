import {Route} from '@effect/ui'

import {Schema} from 'effect'

import {TimeFrame} from '@deslop/runtime/shared/time'

export const GatewayRoute = Route.union({
	Home: Route.make('/', {search: {period: Schema.optional(TimeFrame)}}),
	NotFound: Route.make('/*')
})

export function periodOf(route: typeof GatewayRoute.Type): TimeFrame {
	if (GatewayRoute.isAnyOf(['Home'])(route)) return route.search.period ?? '24h'
	return '24h'
}
