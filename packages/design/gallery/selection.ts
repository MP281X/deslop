import {Command, Component, Route, Router, UiSchema} from '@effect/ui'
import type {View} from '@effect/ui'

import {Boolean, Function, Schema} from 'effect'

import {rows, sheet} from '#gallery/data.ts'
import type {Selection} from '#src/shared/model.ts'

export const GalleryRoute = Route.union({
	Detail: Route.make('/items/:id', {params: {id: Schema.String}}),
	List: Route.make('/'),
	NotFound: Route.make('/*')
})

const Message = UiSchema.TaggedEnum({Closed: {}, Opened: {id: Schema.String}, Routed: {route: GalleryRoute}})

const GallerySelection = Component.define({
	message: Message,
	model: GalleryRoute,
	name: 'GallerySelection',
	props: Schema.Struct({route: GalleryRoute})
}).make({
	init: $ => $.props.route,
	parts: (p, route) => ({
		back: p.part((el, event: string) => el.on(event, Message.Closed())),
		id: GalleryRoute.match(route, {
			Detail: detail => detail.params.id,
			List: Function.constUndefined,
			NotFound: Function.constUndefined
		}),
		select: p.part((el, event: string, id: string) => el.on(event, Message.Opened({id})))
	}),
	subscriptions: $ => [Router.subscription(GalleryRoute, $.model, route => Message.Routed({route}))],
	update: {
		Closed: $ => $.run(Command.asNoop(Router.Back.make({}))),
		Opened: ($, message) => {
			const route = GalleryRoute.Detail({params: {id: message.id}})
			return $.run(
				Command.asNoop(
					Boolean.match(GalleryRoute.isAnyOf(['Detail'])($.model), {
						onFalse: () => Router.push(GalleryRoute, route),
						onTrue: () => Router.replace(GalleryRoute, route)
					})
				)
			)
		},
		Routed: ($, message) => {
			const next = $.set(message.route)
			if (GalleryRoute.isAnyOf(['List'])($.model) && GalleryRoute.isAnyOf(['Detail'])(message.route)) {
				return next.viewTransition(['design-detail-in'])
			}
			if (GalleryRoute.isAnyOf(['Detail'])($.model) && GalleryRoute.isAnyOf(['List'])(message.route)) {
				return next.viewTransition(['design-detail-out'])
			}
			return next
		}
	}
})

export function makeGallery<V extends View.Elements, R>(
	elements: View.Vocabulary<V>,
	render: (
		h: View.WithTags<never, unknown, V>,
		options: {rows: typeof rows; selection: Selection; sheet: typeof sheet}
	) => View.Content<never, R>
) {
	return Component.withElements(elements)({
		message: Schema.Never,
		model: Schema.Null,
		name: 'DesignGallery',
		props: Schema.Struct({route: GalleryRoute})
	}).make({
		init: Function.constNull,
		update: Function.constNull,
		view: h => GallerySelection(h, {props: h.props, view: selection => render(h, {rows, selection, sheet})})
	})
}
