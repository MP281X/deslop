import {Route} from '@effect/ui'

import {Schema} from 'effect'

import {ItemId} from '#contracts'

export const DeployRoute = Route.union({
	Home: Route.make('/', {
		search: {app: Schema.optional(ItemId), pane: Schema.optional(Schema.Literals(['apps', 'process']))}
	}),
	NotFound: Route.make('/*')
})
