import {Route} from '@effect/ui'

import {Schema} from 'effect'

import {ItemId} from '#contracts'

export const DeployRoute = Route.union({
	Home: Route.make('/', {
		search: {app: Schema.optional(ItemId), pane: Schema.optional(Schema.Literals(['apps', 'process']))}
	}),
	NotFound: Route.make('/*')
})

export type DeployRoute = typeof DeployRoute.Type

export function isDetail(route: DeployRoute) {
	return DeployRoute.isAnyOf(['Home'])(route) && route.search.app !== undefined && route.search.pane !== 'apps'
}

export function appOf(route: DeployRoute) {
	if (DeployRoute.isAnyOf(['Home'])(route)) return route.search.app
	return undefined
}
