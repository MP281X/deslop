import {Route} from '@effect/ui'

import {Schema} from 'effect'

import {Pane} from '@deslop/ui/split'

import {NoteId} from '#contracts'

export const StashRoute = Route.union({
	Home: Route.make('/', {search: {note: Schema.optional(NoteId), pane: Schema.optional(Pane)}}),
	NotFound: Route.make('/*')
})
