import {Route} from '@effect/ui'

import {Schema} from 'effect'

import {UserId} from '@deslop/runtime/shared/auth'
import {Pane} from '@deslop/ui/split'

export const AuthRoute = Route.union({
	Home: Route.make('/', {
		search: {
			error: Schema.optional(Schema.String),
			next: Schema.optional(Schema.String),
			pane: Schema.optional(Pane),
			person: Schema.optional(UserId)
		}
	}),
	NotFound: Route.make('/*')
})
