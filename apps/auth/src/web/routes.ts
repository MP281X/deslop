import {Route} from '@effect/ui'

import {Schema} from 'effect'

import {UserId} from '@deslop/runtime/shared/auth'

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
