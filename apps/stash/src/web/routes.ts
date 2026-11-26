import {Route} from '@effect/ui'

import {Schema} from 'effect'

import {NoteId} from '#contracts'

export type Pane = typeof Pane.Type
const Pane = Schema.Literals(['list', 'detail'])

export const StashRoute = Route.union({
	Home: Route.make('/', {search: {note: Schema.optional(NoteId), pane: Schema.optional(Pane)}}),
	NotFound: Route.make('/*')
})
