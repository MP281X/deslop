import '@fontsource-variable/geist/wght.css'
import '@fontsource-variable/geist-mono/wght.css'
import './design.css'

import type {View} from '@effect/ui'
import {Button} from '@effect/ui-kit'
import type {Html} from '@effect/ui/html'

import {Array, Boolean, Function, Option, Predicate, Record, Schema} from 'effect'

import {WatchLayout} from './layout.ts'

import {ListModel, RowModel, listProps} from '#src/shared/model.ts'
import type {ListOptions, ListParts, RowData, Selection} from '#src/shared/model.ts'
import {fold, ink, styles, status} from '#src/shared/styles.ts'
import type {SheetData} from '#src/shared/styles.ts'

const FONT = '-apple-system, system-ui, "Geist Variable", sans-serif'

const UNITLESS = ['flex', 'flexShrink', 'fontWeight']

const TRUNCATE: Html.Style = {minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}
const FIGURES: Html.Style = {fontVariantNumeric: 'tabular-nums'}

type LayoutStyle = Record.ReadonlyRecord<string, string | number>

function web(style: LayoutStyle) {
	return Record.map(style, (value, key) => {
		if (Predicate.isString(value)) return value
		if (Array.contains(UNITLESS, key)) return `${value}`
		return `${value}px`
	})
}

const control = {...web(styles.control), border: '0', color: ink, cursor: 'pointer', fontFamily: FONT}

type SymbolName = typeof SymbolName.Type
const SymbolName = Schema.Literals(['back', 'sheet', 'sidebar'])

const images = {
	back: new URL('./symbols/chevron.left.png', import.meta.url).href,
	sheet: new URL('./symbols/arrow.clockwise.png', import.meta.url).href,
	sidebar: new URL('./symbols/sidebar.left.png', import.meta.url).href
} satisfies Record.ReadonlyRecord<SymbolName, string>

function Icon<M>(h: Html.H<M>, name: SymbolName) {
	return h.span
		.attrs({'aria-hidden': 'true'})
		.style({
			backgroundColor: 'currentColor',
			display: 'inline-block',
			height: '18px',
			mask: `url("${images[name]}") center / contain no-repeat`,
			width: '18px'
		})
}

function Row<M>(h: Html.H<M>, item: RowData, button: ReturnType<typeof Button<M>>) {
	return RowModel(h, {
		key: item.id,
		props: item,
		view: row =>
			button
				.class('design-row')
				.style({
					...web(styles.row),
					backgroundColor: 'var(--design-row-background)',
					border: '0',
					boxSizing: 'border-box',
					cursor: 'pointer',
					fontFamily: FONT,
					textAlign: 'start',
					touchAction: 'pan-y',
					userSelect: 'none',
					webkitUserSelect: 'none',
					width: '100%'
				})
				.children(
					h.span
						.style(web(styles.lead))
						.children(
							h.span
								.style(web(styles.titleLine))
								.children(
									row.status !== undefined && h.span.style({...web(styles.dot), backgroundColor: status[row.status]}),
									h.span.style({...web(styles.title), ...TRUNCATE}).children(row.title)
								),
							h.span.style({...web(styles.line), ...TRUNCATE}).children(row.line)
						),
					row.trailing !== undefined &&
						h.span.style({...web(styles.line), ...FIGURES, flexShrink: '0'}).children(row.trailing)
				)
	})
}

function Sheet<M>(h: Html.H<M>, parts: ListParts, sheet: SheetData) {
	return parts
		.dismissSheet(h.dialog.modal(true), 'cancel')
		.class('design-sheet')
		.attr('aria-label', sheet.title)
		.style({
			...web(styles.sheet),
			border: '0',
			borderRadius: '20px 20px 0 0',
			boxSizing: 'border-box',
			colorScheme: 'dark',
			fontFamily: FONT,
			inset: 'auto 0 0',
			margin: '0 auto',
			maxHeight: '100dvh',
			overflowY: 'auto',
			paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
			width: 'min(100%, 540px)'
		})
		.children(
			h.h2.style({...web(styles.heading), margin: '0'}).children(sheet.title),
			h.p.style({...web(styles.body), margin: '0'}).children(sheet.body),
			h.div
				.style(web(styles.sheetActions))
				.children(parts.dismissSheet(Button(h), 'click').class('design-control').style(control).children(sheet.action))
		)
}

function Chrome<M>(h: Html.H<M>, parts: ListParts, sheet: SheetData, back: Selection['back']) {
	return h.div
		.style({alignItems: 'center', display: 'flex', gap: '8px', minHeight: '52px', padding: '0 12px'})
		.children(
			parts.wide &&
				parts.opened &&
				parts
					.toggleList(Button(h), 'click')
					.class('design-control')
					.style(control)
					.attrs({'aria-label': parts.listAction, 'aria-pressed': `${!parts.listHidden}`})
					.children(Icon(h, 'sidebar')),
			!parts.wide &&
				parts.opened &&
				back(Button(h), 'click')
					.class('design-control')
					.attrs({'aria-label': 'Back'})
					.style(control)
					.children(Icon(h, 'back')),
			h.span.style({flex: '1'}),
			parts.opened &&
				parts
					.openSheet(Button(h), 'click')
					.class('design-control')
					.attrs({'aria-haspopup': 'dialog', 'aria-label': sheet.title})
					.style(control)
					.children(Icon(h, 'sheet'))
		)
}

function Skeleton<M>(h: Html.H<M>, width: string, height: string) {
	return h.div.attr('aria-hidden', 'true').style({backgroundColor: '#202020', borderRadius: '4px', height, width})
}

function RowSkeleton<M>(h: Html.H<M>, index: number) {
	return h.div
		.key(`${index}`)
		.style({
			...web(styles.row),
			alignItems: 'flex-start',
			flexDirection: 'column',
			gap: '6px',
			justifyContent: 'center'
		})
		.children(Skeleton(h, '36%', '12px'), Skeleton(h, '52%', '10px'))
}

export function ListDetail<M, R>(
	h: Html.H<M>,
	options: ListOptions & {detail: (row: RowData) => View.Input<M, R>; sheet: SheetData}
) {
	function list(parts: ListParts, opened: boolean) {
		return h.section
			.attr('aria-label', 'List')
			.style({
				...web(styles.pane),
				...web(styles.rows),
				borderInlineEnd: Boolean.match(parts.wide, {
					onFalse: Function.constUndefined,
					onTrue: () => `1px solid ${fold}`
				}),
				boxSizing: 'border-box',
				display: Boolean.match(parts.listHidden || (!parts.wide && opened), {
					onFalse: Function.constant('block'),
					onTrue: Function.constant('none')
				}),
				flex: Boolean.match(parts.wide, {onFalse: Function.constant('1'), onTrue: () => `0 0 ${parts.splitWidth}px`}),
				overflowY: 'auto'
			})
			.children(
				parts.rows(
					row =>
						Row(
							h,
							row,
							options.selection
								.select(Button(h), 'click', row.id)
								.attr(
									'aria-current',
									Boolean.match(
										parts.wide && !parts.listHidden && Option.exists(parts.note, open => open.id === row.id),
										{onFalse: Function.constUndefined, onTrue: Function.constant('true')}
									)
								)
						),
					index => RowSkeleton(h, index)
				)
			)
	}

	return ListModel(h, {
		props: listProps(options),
		view: parts => {
			const opened = parts.opened || parts.pendingDetail
			return parts
				.watch(h.main, WatchLayout({}))
				.style({
					...web(styles.frame),
					color: ink,
					colorScheme: 'dark',
					flexDirection: 'column',
					fontFamily: FONT,
					height: '100%',
					overflow: 'hidden'
				})
				.children(
					Chrome(h, parts, options.sheet, options.selection.back),
					h.div
						.class('design-panes')
						.style(web(styles.panes))
						.children(
							list(parts, opened),
							(parts.wide || opened) &&
								h.section
									.class('design-detail')
									.attr('aria-label', 'Detail')
									.style({...web(styles.pane), overflowY: 'auto'})
									.children(
										Boolean.match(parts.pendingDetail, {
											onFalse: () =>
												Option.match(parts.note, {
													onNone: Function.constUndefined,
													onSome: row => h.div.key(row.id).style(web(styles.detail)).children(options.detail(row))
												}),
											onTrue: () =>
												h.div.style(web(styles.detail)).children(Skeleton(h, '46%', '20px'), Skeleton(h, '72%', '14px'))
										})
									)
						),
					parts.opened && parts.sheetOpen && Sheet(h, parts, options.sheet)
				)
		}
	})
}

export function DetailText<M>(h: Html.H<M>, title: string, body: string, figure: string) {
	return [
		h.h1.style({...web(styles.heading), margin: '0'}).children(title),
		h.p.style({...web(styles.body), margin: '0'}).children(body),
		h.p
			.style({...web(styles.line), ...FIGURES, fontFamily: '"SF Mono", "Geist Mono Variable", monospace', margin: '0'})
			.children(figure)
	]
}
