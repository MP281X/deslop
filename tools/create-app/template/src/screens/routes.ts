import {Command, Route, Router} from '@effect/ui'

import {Effect, Schema} from 'effect'

export type AppRoute = typeof AppRoute.Type
export const AppRoute = Route.union({
	Item: Route.make('/items/:id', {params: {id: Schema.String}}),
	List: Route.make('/'),
	NotFound: Route.make('/*')
})

export class CloseItem extends Command.Service<CloseItem>()('Items/Close', {args: {}}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Router.Router,
			router => () =>
				Effect.suspend(() => {
					if (router.location().action === 'initial') return router.replace(AppRoute.List({}))
					return router.back
				})
		)
	)
}
