// fallow-ignore-file unused-export unused-type -- New design entry point; apps keep their existing renderer until migration.
import '@fontsource-variable/geist/wght.css'
import '@fontsource-variable/geist-mono/wght.css'
import './design.css'

import type {View} from '@effect/ui'
import {Button} from '@effect/ui-kit'
import type {Html} from '@effect/ui/html'

import {Array, Function, Option, Record} from 'effect'

import {ListModel, RowModel} from '../shared/model.ts'
import type {ListParts, RowData} from '../shared/model.ts'
import {fold, ink, styles, status} from '../shared/styles.ts'
import type {SheetData} from '../shared/styles.ts'

import {WatchLayout} from './history.ts'

export type {RowData} from '../shared/model.ts'

const font = '-apple-system, system-ui, "Geist Variable", sans-serif'

type LayoutStyle = Readonly<Record<string, string | number>>
const unitless = ['flex', 'flexShrink', 'fontWeight']
function web(style: LayoutStyle): Html.Style {
	return Record.map(style, (value, key) => {
		if (typeof value === 'string') return value
		return Array.contains(unitless, key) ? String(value) : `${value}px`
	})
}

const control = {...web(styles.control), color: ink, fontFamily: font, border: '0', cursor: 'pointer'}
const truncate: Html.Style = {minWidth: '0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}
const figures: Html.Style = {fontVariantNumeric: 'tabular-nums'}

const images = {
	sidebar: new URL('./symbols/sidebar.left.png', import.meta.url).href,
	back: new URL('./symbols/chevron.left.png', import.meta.url).href,
	sheet: new URL('./symbols/arrow.clockwise.png', import.meta.url).href
}

function Icon<M>(h: Html.H<M>, name: keyof typeof images) {
	return h.span
		.attrs({'aria-hidden': 'true'})
		.style({
			display: 'inline-block',
			width: '18px',
			height: '18px',
			backgroundColor: 'currentColor',
			mask: `url("${images[name]}") center / contain no-repeat`
		})
}

function Row<M>(h: Html.H<M>, data: RowData, button: ReturnType<typeof Button<M>>) {
	return RowModel(h, {
		key: data.id,
		props: data,
		view: row =>
			button
				.class('design-row')
				.style({
					...web(styles.row),
					textAlign: 'start',
					width: '100%',
					boxSizing: 'border-box',
					fontFamily: font,
					backgroundColor: 'var(--design-row-background)',
					border: '0',
					touchAction: 'pan-y',
					cursor: 'pointer',
					WebkitUserSelect: 'none',
					userSelect: 'none'
				})
				.children(
					h.span
						.style(web(styles.lead))
						.children(
							h.span
								.style(web(styles.titleLine))
								.children(
									row.status !== undefined && h.span.style({...web(styles.dot), backgroundColor: status[row.status]}),
									h.span.style({...web(styles.title), ...truncate}).children(row.title)
								),
							h.span.style({...web(styles.line), ...truncate}).children(row.line)
						),
					row.trailing !== undefined &&
						h.span.style({...web(styles.line), ...figures, flexShrink: '0'}).children(row.trailing)
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
			fontFamily: font,
			colorScheme: 'dark',
			width: 'min(100%, 540px)',
			boxSizing: 'border-box',
			borderRadius: '20px 20px 0 0',
			maxHeight: '100dvh',
			overflowY: 'auto',
			inset: 'auto 0 0',
			margin: '0 auto',
			border: '0',
			paddingBottom: 'max(20px, env(safe-area-inset-bottom))'
		})
		.children(
			h.h2.style({...web(styles.heading), margin: '0'}).children(sheet.title),
			h.p.style({...web(styles.body), margin: '0'}).children(sheet.body),
			h.div
				.style(web(styles.sheetActions))
				.children(parts.dismissSheet(Button(h), 'click').class('design-control').style(control).children(sheet.action))
		)
}

function Chrome<M>(h: Html.H<M>, parts: ListParts, sheet: SheetData) {
	return h.div
		.style({display: 'flex', alignItems: 'center', gap: '8px', minHeight: '52px', padding: '0 12px'})
		.children(
			parts.wide &&
				parts.opened &&
				parts
					.toggleList(Button(h), 'click')
					.class('design-control')
					.style(control)
					.attrs({
						'aria-label': parts.listHidden ? 'Show list' : 'Hide list',
						'aria-pressed': String(!parts.listHidden)
					})
					.children(Icon(h, 'sidebar')),
			!parts.wide &&
				parts.opened &&
				Button(h)
					.class('design-control')
					.attrs({'aria-label': 'Back'})
					.style(control)
					.on('click', () => {
						history.back()
						return undefined
					})
					.children(Icon(h, 'back')),
			h.span.style({flex: '1'}),
			parts.opened &&
				parts
					.openSheet(Button(h), 'click')
					.class('design-control')
					.attrs({'aria-label': sheet.title, 'aria-haspopup': 'dialog'})
					.style(control)
					.children(Icon(h, 'sheet'))
		)
}

export function ListDetail<M, R>(
	h: Html.H<M>,
	options: {rows: readonly RowData[]; detail: (row: RowData) => View.Input<M, R>; sheet: SheetData}
) {
	return ListModel(h, {
		props: {rows: options.rows},
		view: parts =>
			parts
				.watch(h.main, WatchLayout({id: Option.map(parts.note, row => row.id).pipe(Option.getOrUndefined)}))
				.style({
					...web(styles.frame),
					flexDirection: 'column',
					fontFamily: font,
					colorScheme: 'dark',
					color: ink,
					height: '100%',
					overflow: 'hidden'
				})
				.children(
					Chrome(h, parts, options.sheet),
					h.div
						.class('design-panes')
						.style(web(styles.panes))
						.children(
							h.section
								.attr('aria-label', 'List')
								.style({
									...web(styles.pane),
									...web(styles.rows),
									overflowY: 'auto',
									boxSizing: 'border-box',
									display: parts.listHidden || (!parts.wide && parts.opened) ? 'none' : 'block',
									flex: parts.wide ? `0 0 ${parts.splitWidth}px` : '1',
									borderInlineEnd: parts.wide ? `1px solid ${fold}` : undefined
								})
								.children(
									Array.map(options.rows, row =>
										Row(
											h,
											row,
											parts
												.select(Button(h), 'click', row.id)
												.attr(
													'aria-current',
													parts.wide && !parts.listHidden && Option.exists(parts.note, open => open.id === row.id)
														? 'true'
														: undefined
												)
										)
									)
								),
							(parts.wide || parts.opened) &&
								h.section
									.class('design-detail')
									.attr('aria-label', 'Detail')
									.style({...web(styles.pane), overflowY: 'auto'})
									.children(
										Option.match(parts.note, {
											onNone: Function.constUndefined,
											onSome: row => h.div.key(row.id).style(web(styles.detail)).children(options.detail(row))
										})
									)
						),
					parts.sheetOpen && Sheet(h, parts, options.sheet)
				)
	})
}

export function DetailText<M>(h: Html.H<M>, title: string, body: string, figure: string) {
	return [
		h.h1.style({...web(styles.heading), margin: '0'}).children(title),
		h.p.style({...web(styles.body), margin: '0'}).children(body),
		h.p
			.style({...web(styles.line), ...figures, margin: '0', fontFamily: '"SF Mono", "Geist Mono Variable", monospace'})
			.children(figure)
	]
}
