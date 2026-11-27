import {Component, UiSchema} from '@effect/ui'
import type {Mount, View} from '@effect/ui'

import {Array, Boolean, Function, Predicate, Schema} from 'effect'

export type RowData = typeof RowData.Type
const RowData = Schema.Struct({
	id: Schema.String,
	line: Schema.String,
	problem: Schema.optional(Schema.Struct({reason: Schema.String, status: Schema.Literals(['error', 'warning'])})),
	title: Schema.String,
	trailing: Schema.optional(Schema.String)
})

export const RowModel = Component.define({
	message: Schema.Never,
	model: Schema.Null,
	name: 'DesignRow',
	props: RowData
}).make({
	init: Function.constNull,
	parts: p => ({
		line: p.props.problem?.reason ?? p.props.line,
		status: p.props.problem?.status,
		title: p.props.title,
		trailing: p.props.trailing
	}),
	update: Function.constNull
})

const LayoutMessage = UiSchema.TaggedEnum({Resized: {height: Schema.Finite, width: Schema.Finite}, ToggledList: {}})
type LayoutMessage = typeof LayoutMessage.Type

type Layout = typeof Layout.Type
const Layout = Schema.Struct({height: Schema.Finite, listHidden: Schema.Boolean, width: Schema.Finite})

function isWide(size: {width: number; height: number}) {
	return size.width >= 640 && (size.width >= 800 || size.height >= 600)
}

function splitWidth(layout: Layout) {
	if (layout.width < layout.height) return 270
	if (layout.width < 1000) return layout.width / 2
	return 380
}

export const ListModel = Component.define({
	message: LayoutMessage,
	model: Layout,
	name: 'DesignListDetail',
	props: Schema.Struct({
		defaultId: Schema.optional(Schema.String),
		hasDetail: Schema.Boolean,
		id: Schema.UndefinedOr(Schema.String)
	})
}).make({
	init: () => ({height: 0, listHidden: false, width: 0}),
	parts: (p, model) => {
		const wide = isWide(model)
		const showSidebar = wide && p.props.hasDetail
		const listHidden = showSidebar && model.listHidden
		return {
			activeId: Boolean.match(showSidebar && !listHidden, {
				onFalse: Function.constUndefined,
				onTrue: () => p.props.id ?? p.props.defaultId
			}),
			layout: p.part((el, event: string) =>
				el.on(event, value => {
					if (!Predicate.hasProperty(value, 'layout')) return undefined
					if (!Predicate.hasProperty(value.layout, 'width') || !Predicate.hasProperty(value.layout, 'height')) {
						return undefined
					}
					if (!Predicate.isNumber(value.layout.width) || !Predicate.isNumber(value.layout.height)) return undefined
					return LayoutMessage.Resized({height: value.layout.height, width: value.layout.width})
				})
			),
			listAction: Boolean.match(listHidden, {
				onFalse: Function.constant('Hide list'),
				onTrue: Function.constant('Show list')
			}),
			listHidden,
			showSidebar,
			splitWidth: splitWidth(model),
			toggleList: p.part((el, event: string) => el.on(event, LayoutMessage.ToggledList())),
			toolbar: p.part((el, event: string) =>
				el.on(event, value => {
					if (!Predicate.hasProperty(value, 'buttonId') || value.buttonId !== sidebarId) return undefined
					return LayoutMessage.ToggledList()
				})
			),
			watch: p.part((el, mount: Mount.Issued<LayoutMessage, never, unknown, never>) => el.onMount(mount)),
			wide
		}
	},
	update: {
		Resized: ($, size) => {
			if ($.model.width === size.width && $.model.height === size.height) return $.model
			const next = $.evolve(size)
			if (isWide($.model) === isWide(size)) return next
			return next.viewTransition(['design-layout'])
		},
		ToggledList: $ => $.evolve({listHidden: !$.model.listHidden}).viewTransition(['design-layout'])
	}
})

export const sidebarId = 'design-sidebar'
export type ListParts = Component.Headless.Parts<typeof ListModel>
export const resized = LayoutMessage.Resized
export type Selection = {
	id: string | undefined
	select: View.Part<string, [event: string, id: string]>
	back: View.Part<string, [event: string]>
}

export type RowOptions<Content> = {
	item: RowData
	active: boolean
	cover?: Content
	muted?: boolean | undefined
	select?: Selection['select']
	trailing?: Content | undefined
}

export type SheetOptions<Content> = {
	open: boolean
	label: string
	dismiss: Selection['back']
	body: Content
	actions?: Content
	height?: number | undefined
	pending?: boolean | undefined
	toolbar?: ToolbarOptions | undefined
}

export type LayoutOptions<Content> = {toolbar?: ToolbarOptions | undefined; sheet?: SheetOptions<Content> | undefined}

type PaneContent<Leaf> = Leaf | ReadonlyArray<PaneContent<Leaf>>
type PaneLeaf<Content> = Exclude<Content, readonly unknown[]>

function isPaneArray<Leaf>(content: PaneContent<Leaf>): content is readonly PaneContent<Leaf>[] {
	return Array.isArray(content)
}

// Effect UI builders flatten one level; app pane slots may compose several lists.
export function paneChildren<Leaf>(content: PaneContent<Leaf> | undefined): readonly Leaf[] {
	if (content === undefined) return []
	if (isPaneArray(content)) return Array.flatMap(content, paneChildren<Leaf>)
	return [content]
}

export type ListOptions<Content> = LayoutOptions<Content> & {
	defaultId?: string | undefined
	detailToolbar?: readonly ToolbarAction[] | undefined
	selection: Selection
	loading?: boolean
	header?: Content
	empty?: Content
	list?: ((activeId: string | undefined, wide: boolean) => PaneContent<PaneLeaf<Content>>) | undefined
	detail?: PaneContent<PaneLeaf<Content>>
}

export type SymbolName = typeof SymbolName.Type
export const SymbolName = Schema.Literals([
	'airplane.arrival',
	'airplane.departure',
	'airplane',
	'arrow.clockwise',
	'books.vertical',
	'checkmark',
	'chevron.down',
	'chevron.left',
	'chevron.right',
	'clock',
	'cpu',
	'doc.on.clipboard',
	'doc.text',
	'document.on.clipboard',
	'ellipsis',
	'exclamationmark.circle',
	'line.3.horizontal.decrease',
	'link',
	'location',
	'paperclip',
	'photo',
	'play.fill',
	'plus',
	'rectangle.portrait.and.arrow.right',
	'sidebar.left',
	'square.and.arrow.up',
	'square.and.pencil',
	'square.stack',
	'stop.fill',
	'ticket',
	'xmark'
])

export type ToolbarMenuItem = {
	id: string
	label: string
	checked?: boolean | undefined
	disabled?: boolean | undefined
	symbol?: SymbolName | undefined
}

type ToolbarButton = {id: string; label: string; symbol: SymbolName; disabled?: boolean | undefined}

export type ToolbarAction = ToolbarButton & {menu?: readonly ToolbarMenuItem[]}

export type ToolbarOptions = {
	actions: readonly ToolbarAction[]
	choose: View.Part<string, [event: string, id: (payload: unknown) => string | undefined]>
}

export function listToolbar(
	list: ToolbarOptions | undefined,
	detail: readonly ToolbarAction[] | undefined,
	wide: boolean,
	opened: boolean
) {
	if (list === undefined) return undefined
	if (wide) return {...list, actions: [...list.actions, ...(detail ?? [])]}
	if (opened) return {...list, actions: detail ?? []}
	return list
}
