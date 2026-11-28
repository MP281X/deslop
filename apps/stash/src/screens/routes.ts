import {Command, Route} from '@effect/ui'

import {Schema} from 'effect'

import {backOrHome} from '@deslop/components/navigation'

import {NoteId} from '#contracts'

export type StashRoute = typeof StashRoute.Type
export const StashRoute = Route.union({
	Home: Route.make('/', {
		search: {note: Schema.optional(NoteId), pane: Schema.optional(Schema.Literals(['detail', 'list']))}
	}),
	NotFound: Route.make('/*')
})

export function showsDetail(route: StashRoute) {
	return (
		StashRoute.isAnyOf(['Home'])(route) &&
		(route.search.pane === 'detail' || (route.search.pane === undefined && route.search.note !== undefined))
	)
}

export class BackToQueue extends Command.Service<BackToQueue>()('Stash/BackToQueue', {args: {}}) {
	static readonly layer = this.toLayer(backOrHome(StashRoute.Home({search: {}})))
}
