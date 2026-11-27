import {Command, Component, Route, Router, Subscription, UiSchema} from '@effect/ui'
import type {View} from '@effect/ui'

import {Array, Boolean, Effect, Function, Option, Schema, Stream} from 'effect'

import {rows} from '#gallery/data.ts'
import type {RowData, Selection, ToolbarAction, ToolbarOptions} from '#src/shared/model.ts'

export const GalleryRoute = Route.union({
	Detail: Route.make('/items/:id', {params: {id: Schema.String}}),
	List: Route.make('/'),
	NotFound: Route.make('/*')
})

const Filter = Schema.Literals([
	'All',
	'Problems',
	'Empty',
	...Array.makeBy(41, index => `Queue ${index + 1}` as const)
])
const Visibility = Schema.Literals(['Tailnet', 'Public'])
const DEFAULT_ID = 'duo-preview'
const Message = UiSchema.TaggedEnum({
	Closed: {},
	ToolbarChosen: {id: Schema.String},
	Opened: {id: Schema.String},
	Routed: {route: GalleryRoute},
	ToggledReader: {},
	ToggledPending: {},
	DismissedSheet: {},
	Loaded: {}
})
export type GalleryMessage = typeof Message.Type
export const dismissSheet = Message.DismissedSheet()
export const closeReader = Message.ToggledReader()
export const togglePending = Message.ToggledPending()

const GallerySelection = Component.define({
	message: Message,
	events: Message,
	model: Schema.Null,
	name: 'GallerySelection',
	props: Schema.Struct({id: Schema.UndefinedOr(Schema.String)})
}).make({
	init: Function.constNull,
	parts: p => ({
		back: p.part((el, event: string) => el.on(event, Message.Closed())),
		choose: p.part((el, event: string, identify: (payload: unknown) => string | undefined) =>
			el.on(event, payload => {
				const id = identify(payload)
				if (id === undefined) return undefined
				return Message.ToolbarChosen({id})
			})
		),
		dismiss: p.part((el, event: string) => el.on(event, Message.DismissedSheet())),
		id: p.props.id,
		select: p.part((el, event: string, id: string) => el.on(event, Message.Opened({id})))
	}),
	update: ($, message) => $.set(null).emit(message)
})

function filterRows(filter: typeof Filter.Type) {
	if (filter === 'Empty') return []
	if (filter === 'Problems') return Array.filter(rows, row => row.problem !== undefined)
	return rows
}

function toolbar(filter: typeof Filter.Type, listOnly: boolean): readonly ToolbarAction[] {
	return [
		{id: 'list-only', label: listOnly ? 'Show detail' : 'List only', symbol: 'sidebar.left'},
		{id: 'paste', label: 'Paste', symbol: 'doc.on.clipboard'},
		{id: 'reader', label: 'Reader', symbol: 'books.vertical'},
		{
			id: 'filter',
			label: 'Filter',
			symbol: 'line.3.horizontal.decrease',
			menu: Array.map(Filter.literals, item => ({id: item, label: item, checked: item === filter}))
		}
	]
}

function sheetToolbar(visibility: typeof Visibility.Type): readonly ToolbarAction[] {
	return [
		{
			id: 'visibility',
			label: 'Visibility',
			symbol: 'ellipsis',
			menu: Array.map(Visibility.literals, mode => ({id: mode, label: mode, checked: mode === visibility}))
		}
	]
}

export type GalleryView = {
	defaultId: string | undefined
	listOnly: boolean
	loading: boolean
	rows: readonly RowData[]
	selected: RowData | undefined
	selection: Selection
	toolbar: ToolbarOptions
	detailToolbar: readonly ToolbarAction[]
	sheetToolbar: ToolbarOptions
	dismiss: Selection['back']
	visibility: typeof Visibility.Type
	sheetOpen: boolean
	pending: boolean
	reader: boolean
}

export function makeGallery<V extends View.Elements, R>(
	elements: View.Vocabulary<V>,
	render: (h: View.WithTags<GalleryMessage, unknown, V>, options: GalleryView) => View.Content<GalleryMessage, R>
) {
	return Component.withElements(elements)({
		message: Message,
		model: Schema.Struct({
			route: GalleryRoute,
			filter: Filter,
			listOnly: Schema.Boolean,
			loading: Schema.Boolean,
			sheetOpen: Schema.Boolean,
			pending: Schema.Boolean,
			reader: Schema.Boolean,
			visibility: Visibility
		}),
		name: 'DesignGallery',
		props: Schema.Struct({route: GalleryRoute}),
		restore: model => ({...model, pending: false, sheetOpen: false})
	}).make({
		init: $ => ({
			route: $.props.route,
			filter: 'All',
			listOnly: false,
			loading: true,
			sheetOpen: false,
			pending: false,
			reader: false,
			visibility: 'Tailnet'
		}),
		subscriptions: $ => [
			Router.subscription(GalleryRoute, $.model.route, route => Message.Routed({route})),
			$.model.loading &&
				Subscription.make('GalleryLoad', Stream.fromEffect(Effect.as(Effect.sleep('2 seconds'), Message.Loaded())))
		],
		update: {
			Closed: $ => $.run(Command.asNoop(Router.Back.make({}))),
			Loaded: $ => $.evolve({loading: false}),
			Opened: ($, {id}) => {
				const route = GalleryRoute.Detail({params: {id}})
				return $.run(
					Command.asNoop(
						Boolean.match(GalleryRoute.isAnyOf(['Detail'])($.model.route), {
							onFalse: () => Router.push(GalleryRoute, route),
							onTrue: () => Router.replace(GalleryRoute, route)
						})
					)
				)
			},
			Routed: ($, {route}) => {
				const next = $.evolve({route, sheetOpen: false, pending: false})
				if (GalleryRoute.isAnyOf(['List'])($.model.route) && GalleryRoute.isAnyOf(['Detail'])(route)) {
					return next.viewTransition(['design-detail-in'])
				}
				if (GalleryRoute.isAnyOf(['Detail'])($.model.route) && GalleryRoute.isAnyOf(['List'])(route)) {
					return next.viewTransition(['design-detail-out'])
				}
				return next
			},
			DismissedSheet: $ => $.evolve({sheetOpen: false, pending: false}),
			ToolbarChosen: ($, {id}) => {
				if (Schema.is(Filter)(id)) return $.evolve({filter: id})
				if (Schema.is(Visibility)(id)) return $.evolve({visibility: id})
				if (id === 'list-only') return $.evolve({listOnly: !$.model.listOnly})
				if (id === 'reader') return $.evolve({reader: true})
				if (id === 'paste' || id === 'detail-paste') return $.evolve({sheetOpen: true})
				return $.model
			},
			ToggledPending: $ => $.evolve({pending: !$.model.pending}),
			ToggledReader: $ => $.evolve({reader: !$.model.reader})
		},
		view: (h, model) => {
			const id = GalleryRoute.match(model.route, {
				Detail: detail => detail.params.id,
				List: Function.constUndefined,
				NotFound: Function.constUndefined
			})
			return GallerySelection(h, {
				props: {id},
				onEmit: message => message,
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
