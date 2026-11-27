import {Component, UiSchema} from '@effect/ui'
import type {View} from '@effect/ui'

import {Array, Predicate, Schema} from 'effect'

const RowData = Schema.Struct({
	id: Schema.String,
	title: Schema.String,
	line: Schema.String,
	trailing: Schema.optional(Schema.String),
	problem: Schema.optional(Schema.Struct({status: Schema.Literals(['error', 'warning']), reason: Schema.String}))
})

export type RowData = typeof RowData.Type

export const RowModel = Component.define({
	name: 'DesignRow',
	props: RowData,
	model: Schema.Null,
	message: Schema.Never
}).make({
	init: () => null,
	update: () => null,
	parts: p => ({
		title: p.props.title,
		line: p.props.problem?.reason ?? p.props.line,
		trailing: p.props.trailing,
		status: p.props.problem?.status
	})
})

const LayoutMessage = UiSchema.TaggedEnum({
	Chose: {id: Schema.String},
	Closed: {},
	ToggledList: {},
	Resized: {width: Schema.Number, height: Schema.Number},
	Restored: {id: Schema.UndefinedOr(Schema.String)},
	RequestedSheet: {},
	DismissedSheet: {}
})
type LayoutMessage = typeof LayoutMessage.Type

const Layout = Schema.Struct({
	id: Schema.UndefinedOr(Schema.String),
	width: Schema.Number,
	height: Schema.Number,
	listHidden: Schema.Boolean,
	sheetOpen: Schema.Boolean
})
type Layout = typeof Layout.Type

export function isWide({width, height}: {width: number; height: number}) {
	return width >= 640 && (width >= 800 || height >= 600)
}

function splitWidth({width, height}: Layout) {
	if (width < height) return 270
	return width < 1000 ? width / 2 : 380
}

export const ListModel = Component.define({
	name: 'DesignListDetail',
	props: Schema.Struct({rows: Schema.Array(RowData)}),
	model: Layout,
	message: LayoutMessage
}).make({
	init: () => ({id: undefined, width: 0, height: 0, listHidden: false, sheetOpen: false}),
	update: {
		Chose: ($, {id}) => {
			if ($.model.id === id) return $.model
			return $.evolve({id}).viewTransition(isWide($.model) ? [] : ['design-detail-in'])
		},
		Closed: $ => {
			if (isWide($.model)) return $.model
			return $.evolve({id: undefined, listHidden: false, sheetOpen: false}).viewTransition(['design-detail-out'])
		},
		ToggledList: $ => $.evolve({listHidden: !$.model.listHidden}).viewTransition(['design-layout']),
		Resized: ($, size) => {
			if ($.model.width === size.width && $.model.height === size.height) return $.model
			const next = $.evolve(size)
			return isWide($.model) === isWide(size) ? next : next.viewTransition(['design-layout'])
		},
		Restored: ($, {id}) => {
			if ($.model.id === id) return $.model
			return $.evolve({id, listHidden: false, sheetOpen: false}).viewTransition(
				isWide($.model) ? [] : [id === undefined ? 'design-detail-out' : 'design-detail-in']
			)
		},
		RequestedSheet: $ => $.evolve({sheetOpen: true}),
		DismissedSheet: $ => $.evolve({sheetOpen: false})
	},
	parts: (p, model) => {
		const note = Array.findFirst(p.props.rows, row => row.id === model.id)
		const wide = isWide(model)
		const opened = Array.some(p.props.rows, row => row.id === model.id)
		return {
			note,
			wide,
			opened,
			splitWidth: splitWidth(model),
			listHidden: wide && opened && model.listHidden,
			sheetOpen: model.sheetOpen,
			select: p.part((el, event: string, id: string) => el.on(event, LayoutMessage.Chose({id}))),
			dismissDetail: p.part((el, event: string) => el.on(event, LayoutMessage.Closed())),
			dismissSheet: p.part((el, event: string) =>
				el.on(event, LayoutMessage.DismissedSheet(), event === 'cancel' ? {preventDefault: true} : undefined)
			),
			openSheet: p.part((el, event: string) => el.on(event, LayoutMessage.RequestedSheet())),
			toolbar: p.part((el, event: string) =>
				el.on(event, value => {
					if (!Predicate.hasProperty(value, 'buttonId')) return undefined
					if (value.buttonId === 'sidebar') return LayoutMessage.ToggledList()
					if (value.buttonId === 'sheet') return LayoutMessage.RequestedSheet()
					if (value.buttonId === 'dismiss') return LayoutMessage.DismissedSheet()
					return undefined
				})
			),
			toggleList: p.part((el, event: string) => el.on(event, LayoutMessage.ToggledList())),
			layout: p.part((el, event: string) =>
				el.on(event, value => {
					if (!Predicate.hasProperty(value, 'layout')) return undefined
					const size = value.layout
					if (!Predicate.hasProperty(size, 'width') || !Predicate.hasProperty(size, 'height')) return undefined
					if (!Predicate.isNumber(size.width) || !Predicate.isNumber(size.height)) return undefined
					return LayoutMessage.Resized({width: size.width, height: size.height})
				})
			),
			watch: p.part((el, mount: View.Mount<LayoutMessage>) => el.onMount(mount))
		}
	}
})

export type ListParts = Component.Headless.Parts<typeof ListModel>
export const resized = LayoutMessage.Resized
export const restored = LayoutMessage.Restored
