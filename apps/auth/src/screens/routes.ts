import {Route} from '@effect/ui'

import {Schema} from 'effect'

import {UserId} from '@deslop/runtime/shared/auth'

export type AuthRoute = typeof AuthRoute.Type
export const AuthRoute = Route.union({
	Home: Route.make('/', {
		search: {
			error: Schema.optional(Schema.String),
			next: Schema.optional(Schema.String),
			pane: Schema.optional(Schema.Literals(['list', 'detail'])),
			person: Schema.optional(UserId)
		}
	}),
	NotFound: Route.make('/*')
})

export const isHome = AuthRoute.isAnyOf(['Home'])

export function selectedOf(route: AuthRoute) {
	if (!isHome(route) || route.search.pane === 'list') return undefined
	return route.search.person
}

export function detailIsOpen(route: AuthRoute) {
	return isHome(route) && (route.search.pane === 'detail' || selectedOf(route) !== undefined)
}
