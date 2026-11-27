import {Command, Route} from '@effect/ui'

import {Schema} from 'effect'

import {backOrHome} from '@deslop/design/navigation'

export type AppRoute = typeof AppRoute.Type
export const AppRoute = Route.union({
	Item: Route.make('/items/:id', {params: {id: Schema.String}}),
	List: Route.make('/'),
	NotFound: Route.make('/*')
})

export class CloseItem extends Command.Service<CloseItem>()('Items/Close', {args: {}}) {
	static readonly layer = this.toLayer(backOrHome(AppRoute.List({})))
}
