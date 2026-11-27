import {Command, Route, Router} from '@effect/ui'

import {Effect, Schema} from 'effect'

export const AppRoute = Route.union({
	Item: Route.make('/items/:id', {params: {id: Schema.String}}),
	List: Route.make('/'),
	NotFound: Route.make('/*')
})

export const OpenItem = Command.make('Items/Open', {args: {id: Schema.String}}, args =>
	Effect.gen(function* () {
		const router = yield* Router.Router
		const item = AppRoute.Item({params: {id: args.id}})
		if (AppRoute.isAnyOf(['Item'])(router.location().route)) yield* router.replace(item)
		else yield* router.push(item)
	})
)

export const CloseItem = Command.make(
	'Items/Close',
	{args: {}},
	Effect.fnUntraced(function* () {
		const router = yield* Router.Router
		if (router.location().action === 'initial') yield* router.replace(AppRoute.List({}))
		else yield* router.back
	})
)
