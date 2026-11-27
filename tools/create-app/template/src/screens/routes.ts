import {Command, Route, Router} from '@effect/ui'

import {Effect, Schema} from 'effect'

export const AppRoute = Route.union({
	List: Route.make('/'),
	Item: Route.make('/items/:id', {params: {id: Schema.String}}),
	NotFound: Route.make('/*')
})

export const OpenItem = Command.make('Items/Open', {args: {id: Schema.String}}, ({id}) =>
	Effect.gen(function* () {
		const router = yield* Router.Router
		const item = AppRoute.Item({params: {id}})
		if (router.location().route._tag === 'Item') yield* router.replace(item)
		else yield* router.push(item)
	})
)

export const CloseItem = Command.make('Items/Close', {args: {}}, () =>
	Effect.gen(function* () {
		const router = yield* Router.Router
		if (router.location().action === 'initial') yield* router.replace(AppRoute.List({}))
		else yield* router.back
	})
)
