import {Component, UiSchema} from '@effect/ui'
import type {Mount, View} from '@effect/ui'

import {Array, Boolean, Function, Option, Predicate, Schema} from 'effect'

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

const LayoutMessage = UiSchema.TaggedEnum({
	DismissedSheet: {},
	RequestedSheet: {},
	Resized: {height: Schema.Finite, width: Schema.Finite},
	ToggledList: {}
})
type LayoutMessage = typeof LayoutMessage.Type

type Layout = typeof Layout.Type
const Layout = Schema.Struct({
	height: Schema.Finite,
	listHidden: Schema.Boolean,
	sheetOpen: Schema.Boolean,
	width: Schema.Finite
})

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
	props: Schema.Struct({id: Schema.UndefinedOr(Schema.String), loading: Schema.Boolean, rows: Schema.Array(RowData)})
}).make({
	init: () => ({height: 0, listHidden: false, sheetOpen: false, width: 0}),
	parts: (p, model) => {
		const note = Array.findFirst(p.props.rows, row => row.id === p.props.id)
		const wide = isWide(model)
		const opened = Option.isSome(note)
		return {
			dismissSheet: p.part((el, event: string) =>
				el.on(
					event,
					LayoutMessage.DismissedSheet(),
					Boolean.match(event === 'cancel', {
						onFalse: Function.constUndefined,
						onTrue: () => ({preventDefault: true as const})
					})
				)
			),
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
			listAction: Boolean.match(wide && opened && model.listHidden, {
				onFalse: Function.constant('Hide list'),
				onTrue: Function.constant('Show list')
			}),
			listHidden: wide && opened && model.listHidden,
			note,
			openSheet: p.part((el, event: string) => el.on(event, LayoutMessage.RequestedSheet())),
			opened,
			pendingDetail: p.props.loading && p.props.id !== undefined,
			rows<R, S>(renderRow: (row: RowData) => R, renderSkeleton: (index: number) => S) {
				if (p.props.loading) return Array.makeBy(3, renderSkeleton)
				return Array.map(p.props.rows, renderRow)
			},
			sheetOpen: model.sheetOpen,
			splitWidth: splitWidth(model),
			toggleList: p.part((el, event: string) => el.on(event, LayoutMessage.ToggledList())),
			toolbar: p.part((el, event: string) =>
				el.on(event, value => {
					if (!Predicate.hasProperty(value, 'buttonId')) return undefined
					if (value.buttonId === 'sidebar') return LayoutMessage.ToggledList()
					if (value.buttonId === 'sheet') return LayoutMessage.RequestedSheet()
					if (value.buttonId === 'dismiss') return LayoutMessage.DismissedSheet()
					return undefined
				})
			),
			watch: p.part((el, mount: Mount.Issued<LayoutMessage, never, unknown, never>) => el.onMount(mount)),
			wide
		}
	},
	update: {
		DismissedSheet: $ => $.evolve({sheetOpen: false}),
		RequestedSheet: $ => $.evolve({sheetOpen: true}),
		Resized: ($, size) => {
			if ($.model.width === size.width && $.model.height === size.height) return $.model
			const next = $.evolve(size)
			if (isWide($.model) === isWide(size)) return next
			return next.viewTransition(['design-layout'])
		},
		ToggledList: $ => $.evolve({listHidden: !$.model.listHidden}).viewTransition(['design-layout'])
	}
})

export type ListParts = Component.Headless.Parts<typeof ListModel>
export const resized = LayoutMessage.Resized
export type Selection = {
	id: Parameters<typeof ListModel>[1]['props']['id']
	select: View.Part<string, [event: string, id: string]>
	back: View.Part<string, [event: string]>
}

export type ListOptions = {loading?: boolean; rows: readonly RowData[]; selection: Selection}

export function listProps(options: ListOptions) {
	return {id: options.selection.id, loading: options.loading === true, rows: options.rows}
}
