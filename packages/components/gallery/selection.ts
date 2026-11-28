import {Command, Component, Route, Router, Subscription, UiSchema} from '@effect/ui'
import type {View} from '@effect/ui'

import {Array, Boolean, Effect, Function, Option, Schema, Stream} from 'effect'

import {rows} from '#gallery/data.ts'
import {chooseToolbar, defineSelection} from '#src/shared/model.ts'
import type {RowData, Selection, ToolbarAction, ToolbarOptions} from '#src/shared/model.ts'

const DEFAULT_ID = 'duo-preview'

export const GalleryRoute = Route.union({
	Detail: Route.make('/items/:id', {params: {id: Schema.String}}),
	List: Route.make('/'),
	NotFound: Route.make('/*')
})

type Filter = typeof Filter.Type
const Filter = Schema.Literals([
	'All',
	'Problems',
	'Empty',
	...Array.makeBy(41, index => `Queue ${index + 1}` as const)
])
export type Visibility = typeof Visibility.Type
const Visibility = Schema.Literals(['Tailnet', 'Public'])
const Message = UiSchema.TaggedEnum({
	Closed: {},
	DismissedSheet: {},
	Loaded: {},
	Opened: {id: Schema.String},
	Routed: {route: GalleryRoute},
	ToggledPending: {},
	ToggledReader: {},
	ToolbarChosen: {id: Schema.String}
})
export type GalleryMessage = typeof Message.Type
export const dismissSheet = Message.DismissedSheet()
export const closeReader = Message.ToggledReader()
export const togglePending = Message.ToggledPending()

const GallerySelection = defineSelection('GallerySelection', Message).make({
	init: Function.constUndefined,
	parts: p => ({
		back: p.part((el, event: string) => el.on(event, Message.Closed())),
		choose: p.part(chooseToolbar<GalleryMessage>(Message.ToolbarChosen)),
		dismiss: p.part((el, event: string) => el.on(event, Message.DismissedSheet())),
		id: p.props.id,
		select: p.part((el, event: string, id: string) => el.on(event, Message.Opened({id})))
	}),
	update: ($, message) => $.set(undefined).emit(message)
})

function filterRows(filter: Filter) {
	if (filter === 'Empty') return []
	if (filter === 'Problems') return Array.filter(rows, row => row.problem !== undefined)
	return rows
}

function toolbar(filter: Filter, listOnly: boolean) {
	return [
		{
			id: 'list-only',
			label: Boolean.match(listOnly, {
				onFalse: Function.constant('List only'),
				onTrue: Function.constant('Show detail')
			}),
			symbol: 'sidebar.left'
		},
		{id: 'paste', label: 'Paste', symbol: 'doc.on.clipboard'},
		{id: 'reader', label: 'Reader', symbol: 'books.vertical'},
		{
			id: 'filter',
			label: 'Filter',
			menu: Array.map(Filter.literals, item => ({checked: item === filter, id: item, label: item})),
			symbol: 'line.3.horizontal.decrease'
		}
	] satisfies readonly ToolbarAction[]
}

function sheetToolbar(visibility: Visibility) {
	return [
		{
			id: 'visibility',
			label: 'Visibility',
			menu: Array.map(Visibility.literals, mode => ({checked: mode === visibility, id: mode, label: mode})),
			symbol: 'ellipsis'
		}
	] satisfies readonly ToolbarAction[]
}

export type GalleryView = {
	defaultId: Selection['id']
	listOnly: boolean
	loading: boolean
	rows: readonly RowData[]
	selected: ReturnType<typeof Option.getOrUndefined<RowData>>
	selection: Selection
	toolbar: ToolbarOptions
	detailToolbar: readonly ToolbarAction[]
	sheetToolbar: ToolbarOptions
	dismiss: Selection['back']
	visibility: Visibility
	sheetOpen: boolean
	pending: boolean
	reader: boolean
}

export function makeGallery<V extends View.Elements>(
	elements: View.Vocabulary<V>,
	render: (h: View.WithTags<GalleryMessage, unknown, V>, options: GalleryView) => View.Content<GalleryMessage>
) {
	return Component.withElements(elements)({
		message: Message,
		model: Schema.Struct({
			filter: Filter,
			listOnly: Schema.Boolean,
			loading: Schema.Boolean,
			pending: Schema.Boolean,
			reader: Schema.Boolean,
			route: GalleryRoute,
			sheetOpen: Schema.Boolean,
			visibility: Visibility
		}),
		name: 'DesignGallery',
		props: Schema.Struct({route: GalleryRoute}),
		restore: model => ({...model, pending: false, sheetOpen: false})
	}).make({
		init: $ => ({
			filter: 'All',
			listOnly: false,
			loading: true,
			pending: false,
			reader: false,
			route: $.props.route,
			sheetOpen: false,
			visibility: 'Tailnet'
		}),
		subscriptions: $ => [
			Router.subscription(GalleryRoute, $.model.route, route => Message.Routed({route})),
			$.model.loading &&
				Subscription.make('GalleryLoad', Stream.fromEffect(Effect.as(Effect.sleep('2 seconds'), Message.Loaded())))
		],
		update: {
			Closed: $ => $.run(Command.asNoop(Router.Back.make({}))),
			DismissedSheet: $ => $.evolve({pending: false, sheetOpen: false}),
			Loaded: $ => $.evolve({loading: false}),
			Opened: ($, message) => {
				const route = GalleryRoute.Detail({params: {id: message.id}})
				return $.run(
					Command.asNoop(
						Boolean.match(GalleryRoute.isAnyOf(['Detail'])($.model.route), {
							onFalse: () => Router.push(GalleryRoute, route),
							onTrue: () => Router.replace(GalleryRoute, route)
						})
					)
				)
			},
			Routed: ($, message) => {
				const next = $.evolve({pending: false, route: message.route, sheetOpen: false})
				if (GalleryRoute.isAnyOf(['List'])($.model.route) && GalleryRoute.isAnyOf(['Detail'])(message.route)) {
					return next.viewTransition(['design-detail-in'])
				}
				if (GalleryRoute.isAnyOf(['Detail'])($.model.route) && GalleryRoute.isAnyOf(['List'])(message.route)) {
					return next.viewTransition(['design-detail-out'])
				}
				return next
			},
			ToggledPending: $ => $.evolve({pending: !$.model.pending}),
			ToggledReader: $ => $.evolve({reader: !$.model.reader}),
			ToolbarChosen: ($, message) => {
				if (Schema.is(Filter)(message.id)) return $.evolve({filter: message.id})
				if (Schema.is(Visibility)(message.id)) return $.evolve({visibility: message.id})
				if (message.id === 'list-only') return $.evolve({listOnly: !$.model.listOnly})
				if (message.id === 'reader') return $.evolve({reader: true})
				if (message.id === 'paste' || message.id === 'detail-paste') return $.evolve({sheetOpen: true})
				return $.model
			}
		},
		view: (h, model) => {
			const id = GalleryRoute.match(model.route, {
				Detail: detail => detail.params.id,
				List: Function.constUndefined,
				NotFound: Function.constUndefined
			})
			return GallerySelection(h, {
				onEmit: message => message,
				props: {id},
				view: selection =>
					render(h, {
						defaultId: Boolean.match(model.loading, {
							onFalse: Function.constant(DEFAULT_ID),
							onTrue: Function.constUndefined
						}),
						detailToolbar: [{id: 'detail-paste', label: 'Compose', symbol: 'square.and.pencil'}],
						dismiss: selection.dismiss,
						listOnly: model.listOnly,
						loading: model.loading,
						pending: model.pending,
						reader: model.reader,
						rows: filterRows(model.filter),
						selected: Option.getOrUndefined(Array.findFirst(rows, row => row.id === (id ?? DEFAULT_ID))),
						selection,
						sheetOpen: model.sheetOpen,
						sheetToolbar: {actions: sheetToolbar(model.visibility), choose: selection.choose},
						toolbar: {actions: toolbar(model.filter, model.listOnly), choose: selection.choose},
						visibility: model.visibility
					})
			})
		}
	})
}
