import {Command, Component, Route, Router, UiSchema} from '@effect/ui'

import {Schema} from 'effect'

export const GalleryRoute = Route.union({
	List: Route.make('/'),
	Detail: Route.make('/items/:id', {params: {id: Schema.String}}),
	NotFound: Route.make('/*')
})

const Message = UiSchema.TaggedEnum({Closed: {}, Opened: {id: Schema.String}, Routed: {route: GalleryRoute}})

export const GallerySelection = Component.define({
	name: 'GallerySelection',
	props: Schema.Struct({route: GalleryRoute}),
	model: GalleryRoute,
	message: Message
}).make({
	init: ({props}) => props.route,
	subscriptions: ({model}) => [Router.subscription(GalleryRoute, model, route => Message.Routed({route}))],
	update: {
		Closed: $ => $.run(Command.asNoop(Router.Back.make({}))),
		Opened: ($, {id}) => {
			const route = GalleryRoute.Detail({params: {id}})
			return $.run(
				Command.asNoop(
					$.model._tag === 'Detail' ? Router.replace(GalleryRoute, route) : Router.push(GalleryRoute, route)
				)
			)
		},
		Routed: ($, {route}) => {
			const next = $.set(route)
			if ($.model._tag === 'List' && route._tag === 'Detail') return next.viewTransition(['design-detail-in'])
			if ($.model._tag === 'Detail' && route._tag === 'List') return next.viewTransition(['design-detail-out'])
			return next
		}
	},
	parts: (p, route) => ({
		id: route._tag === 'Detail' ? route.params.id : undefined,
		select: p.part((el, event: string, id: string) => el.on(event, Message.Opened({id}))),
		back: p.part((el, event: string) => el.on(event, Message.Closed()))
	})
})
