import '@fontsource-variable/geist/wght.css'
import '@fontsource-variable/geist-mono/wght.css'
import './design.css'

import type {View} from '@effect/ui'
import {Button} from '@effect/ui-kit'
import type {Html} from '@effect/ui/html'

import {Array, Boolean, Function, Option, Predicate, Record, pipe} from 'effect'

import {WatchLayout} from './layout.ts'

import {ListModel, RowModel, detailState, listChildren, listToolbar, paneChildren} from '#src/shared/model.ts'
import type {
	LayoutOptions,
	ListOptions,
	ListParts,
	PaneLeaf,
	RowOptions,
	SheetOptions,
	SymbolName,
	ToolbarOptions
} from '#src/shared/model.ts'
import {fold, ink, selected, status, styles} from '#src/shared/styles.ts'

const FONT = '-apple-system, system-ui, "Geist Variable", sans-serif'

const UNITLESS = ['aspectRatio', 'flex', 'flexGrow', 'flexShrink', 'fontWeight', 'opacity', 'order', 'zIndex']

const TRUNCATE: Html.Style = {minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}
const FIGURES: Html.Style = {fontVariantNumeric: 'tabular-nums'}

export {WatchLayout, ink, selected, status, styles}

export type LayoutStyle = Record.ReadonlyRecord<string, string | number>

export function webStyle(style: LayoutStyle) {
	return Record.map(style, (value, key) => {
		if (Predicate.isString(value)) return value
		if (Array.contains(UNITLESS, key)) return `${value}`
		return `${value}px`
	})
}

const control = {...webStyle(styles.control), border: '0', color: ink, cursor: 'pointer', fontFamily: FONT}

const images = {
	airplane: new URL('./symbols/airplane.png', import.meta.url).href,
	'airplane.arrival': new URL('./symbols/airplane.arrival.png', import.meta.url).href,
	'airplane.departure': new URL('./symbols/airplane.departure.png', import.meta.url).href,
	'arrow.clockwise': new URL('./symbols/arrow.clockwise.png', import.meta.url).href,
	'books.vertical': new URL('./symbols/books.vertical.png', import.meta.url).href,
	checkmark: new URL('./symbols/checkmark.png', import.meta.url).href,
	'chevron.down': new URL('./symbols/chevron.down.png', import.meta.url).href,
	'chevron.left': new URL('./symbols/chevron.left.png', import.meta.url).href,
	'chevron.right': new URL('./symbols/chevron.right.png', import.meta.url).href,
	clock: new URL('./symbols/clock.png', import.meta.url).href,
	cpu: new URL('./symbols/cpu.png', import.meta.url).href,
	'doc.on.clipboard': new URL('./symbols/doc.on.clipboard.png', import.meta.url).href,
	'doc.text': new URL('./symbols/doc.text.png', import.meta.url).href,
	'document.on.clipboard': new URL('./symbols/document.on.clipboard.png', import.meta.url).href,
	ellipsis: new URL('./symbols/ellipsis.png', import.meta.url).href,
	'exclamationmark.circle': new URL('./symbols/exclamationmark.circle.png', import.meta.url).href,
	'line.3.horizontal.decrease': new URL('./symbols/line.3.horizontal.decrease.png', import.meta.url).href,
	link: new URL('./symbols/link.png', import.meta.url).href,
	location: new URL('./symbols/location.png', import.meta.url).href,
	paperclip: new URL('./symbols/paperclip.png', import.meta.url).href,
	photo: new URL('./symbols/photo.png', import.meta.url).href,
	'play.fill': new URL('./symbols/play.fill.png', import.meta.url).href,
	plus: new URL('./symbols/plus.png', import.meta.url).href,
	'rectangle.portrait.and.arrow.right': new URL('./symbols/rectangle.portrait.and.arrow.right.png', import.meta.url)
		.href,
	'sidebar.left': new URL('./symbols/sidebar.left.png', import.meta.url).href,
	'square.and.arrow.up': new URL('./symbols/square.and.arrow.up.png', import.meta.url).href,
	'square.and.pencil': new URL('./symbols/square.and.pencil.png', import.meta.url).href,
	'square.stack': new URL('./symbols/square.stack.png', import.meta.url).href,
	'stop.fill': new URL('./symbols/stop.fill.png', import.meta.url).href,
	ticket: new URL('./symbols/ticket.png', import.meta.url).href,
	xmark: new URL('./symbols/xmark.png', import.meta.url).href
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

export function Row<M, R>(h: Html.H<M>, options: RowOptions<View.Input<M, R>>) {
	const element = Option.match(Option.fromUndefinedOr(options.select), {
		onNone: () => h.div,
		onSome: select => select(Button(h), 'click', options.item.id)
	})
	const title = {
		...webStyle(styles.title),
		...TRUNCATE,
		color: Boolean.match(options.muted === true, {
			onFalse: Function.constant(ink),
			onTrue: Function.constant(styles.line.color)
		})
	}
	return RowModel(h, {
		key: options.item.id,
		props: options.item,
		view: row =>
			element
				.attr(
					'aria-current',
					Boolean.match(options.active, {onFalse: Function.constUndefined, onTrue: Function.constant('true')})
				)
				.attr(
					'data-interactive',
					Boolean.match(options.select !== undefined, {onFalse: Function.constUndefined, onTrue: Function.constant('')})
				)
				.class('design-row')
				.style({
					...webStyle(styles.row),
					backgroundColor: 'var(--design-row-background)',
					border: '0',
					boxSizing: 'border-box',
					cursor: options.select !== undefined && 'pointer',
					fontFamily: FONT,
					textAlign: 'start',
					touchAction: 'pan-y',
					userSelect: 'none',
					webkitUserSelect: 'none',
					width: '100%'
				})
				.children(
					options.cover,
					h.span
						.style(webStyle(styles.lead))
						.children(
							h.span
								.style(webStyle(styles.titleLine))
								.children(
									row.status !== undefined &&
										h.span.style({...webStyle(styles.dot), backgroundColor: status[row.status]}),
									h.span.style(title).children(row.title)
								),
							h.span.style({...webStyle(styles.line), ...TRUNCATE}).children(row.line)
						),
					options.trailing ??
						(row.trailing !== undefined &&
							h.span.style({...webStyle(styles.line), ...FIGURES, flexShrink: '0'}).children(row.trailing))
				)
	})
}

function toolbarView<M>(h: Html.H<M>, toolbar?: ToolbarOptions, leading?: View.Input<M>, scope = 'screen') {
	return h.div
		.style({alignItems: 'center', display: 'flex', gap: '8px', minHeight: '52px', padding: '0 12px'})
		.children(
			leading,
			h.span.style({flex: '1'}),
			toolbar !== undefined &&
				Array.map(toolbar.actions, action => {
					const button = Button(h, {props: {disabled: action.disabled}})
						.class('design-control')
						.attr('aria-label', action.label)
						.style(control)
						.children(Icon(h, action.symbol))
					if (action.menu === undefined) return toolbar.choose(button.key(action.id), 'click', () => action.id)
					const id = `design-menu-${scope}-${action.id}`
					return h.div.key(action.id).children(
						button.attr('popovertarget', id),
						h.div
							.class('design-menu')
							.attrs({'aria-label': action.label, id, popover: 'auto', role: 'group'})
							.style({
								backgroundColor: styles.sheet.backgroundColor,
								border: '0',
								borderRadius: '8px',
								boxSizing: 'border-box',
								color: ink,
								fontFamily: FONT,
								minWidth: '160px',
								padding: '4px'
							})
							.children(
								Array.map(action.menu, item =>
									toolbar.choose(
										Button(h, {props: {disabled: item.disabled}})
											.key(item.id)
											.class('design-menu-item')
											.attrs({
												'aria-pressed': pipe(
													Option.fromUndefinedOr(item.checked),
													Option.map(checked => `${checked}`),
													Option.getOrUndefined
												),
												popovertarget: id,
												popovertargetaction: 'hide'
											})
											.style({
												...control,
												backgroundColor: 'transparent',
												gap: '8px',
												justifyContent: 'flex-start',
												textAlign: 'start',
												width: '100%'
											})
											.children(
												item.symbol !== undefined && Icon(h, item.symbol),
												h.span.style({flex: '1'}).children(item.label),
												item.checked === true && Icon(h, 'checkmark')
											),
										'click',
										() => item.id
									)
								)
							)
					)
				})
		)
}

function Sheet<M, R>(h: Html.H<M>, options: SheetOptions<View.Input<M, R>>) {
	if (!options.open) return undefined
	const dialog = h.dialog.modal(true).on('cancel', Function.constUndefined, {preventDefault: 'always'})
	const element = Boolean.match(options.pending === true, {
		onFalse: () => options.dismiss(dialog, 'cancel'),
		onTrue: () => dialog
	})
	return element
		.class('design-sheet')
		.attr('aria-label', options.label)
		.style({
			...webStyle(styles.sheet),
			border: '0',
			borderRadius: '20px 20px 0 0',
			boxSizing: 'border-box',
			colorScheme: 'dark',
			fontFamily: FONT,
			height: pipe(
				Option.fromUndefinedOr(options.height),
				Option.map(fraction => `${fraction * 100}dvh`),
				Option.getOrUndefined
			),
			inset: 'auto 0 0',
			margin: '0 auto',
			maxHeight: '100dvh',
			paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
			width: 'min(100%, 540px)'
		})
		.children(
			options.toolbar !== undefined && toolbarView(h, options.toolbar, undefined, 'sheet'),
			h.div.style({flex: '1', minHeight: '0', overflowY: 'auto'}).children(options.body),
			options.actions !== undefined && h.div.style(webStyle(styles.sheetActions)).children(options.actions)
		)
}

export function Toolbar<M>(h: Html.H<M>, toolbar: ToolbarOptions) {
	return toolbarView(h, toolbar)
}

function chrome<M, R>(h: Html.H<M>, parts: ListParts, options: ListOptions<View.Input<M, R>>, opened: boolean) {
	return toolbarView(h, listToolbar(options.toolbar, options.detailToolbar, parts.showSidebar, opened), [
		parts.showSidebar &&
			parts
				.toggleList(Button(h), 'click')
				.class('design-control')
				.style(control)
				.attrs({'aria-label': parts.listAction, 'aria-pressed': `${!parts.listHidden}`})
				.children(Icon(h, 'sidebar.left')),
		!parts.wide &&
			opened &&
			options.selection
				.back(Button(h), 'click')
				.class('design-control')
				.attr('aria-label', 'Back')
				.style(control)
				.children(Icon(h, 'chevron.left'))
	])
}

function frame<M>(h: Html.H<M>) {
	return h.main.style({
		...webStyle(styles.frame),
		color: ink,
		colorScheme: 'dark',
		flexDirection: 'column',
		fontFamily: FONT,
		height: '100%',
		overflow: 'hidden'
	})
}

export function Layout<M, R>(h: Html.H<M>, options: LayoutOptions<View.Input<M, R>> & {content: View.Input<M, R>}) {
	return frame(h).children(
		options.toolbar !== undefined && Toolbar(h, options.toolbar),
		options.content,
		options.sheet !== undefined && Sheet<M, R>(h, options.sheet)
	)
}

function Skeleton<M>(h: Html.H<M>, width: string, height: string) {
	return h.div.attr('aria-hidden', 'true').style({backgroundColor: '#202020', borderRadius: '4px', height, width})
}

function RowSkeleton<M>(h: Html.H<M>, index: number) {
	return h.div
		.key(`${index}`)
		.style({
			...webStyle(styles.row),
			alignItems: 'flex-start',
			flexDirection: 'column',
			gap: '6px',
			justifyContent: 'center'
		})
		.children(Skeleton(h, '36%', '12px'), Skeleton(h, '52%', '10px'))
}

export function ListDetail<M, R>(h: Html.H<M>, options: ListOptions<View.Input<M, R>>) {
	const detailLayout = detailState(options)

	function list(parts: ListParts) {
		const children = listChildren<PaneLeaf<View.Input<M, R>>, View.Input<M, R>>(options, parts, index =>
			RowSkeleton(h, index)
		)
		return h.section
			.attr('aria-label', 'List')
			.style({
				...webStyle(styles.pane),
				...webStyle(styles.rows),
				borderInlineEnd: parts.showSidebar && `1px solid ${fold}`,
				boxSizing: 'border-box',
				display: Boolean.match(parts.listHidden || (!parts.wide && detailLayout.opened), {
					onFalse: Function.constant('block'),
					onTrue: Function.constant('none')
				}),
				flex: Boolean.match(parts.showSidebar, {
					onFalse: Function.constant('1'),
					onTrue: () => `0 0 ${parts.splitWidth}px`
				}),
				overflowY: 'auto'
			})
			.children(...children)
	}

	return ListModel(h, {
		props: detailLayout.props,
		view: parts =>
			parts.watch(frame(h), WatchLayout({})).children(
				chrome(h, parts, options, detailLayout.opened),
				h.div
					.class('design-panes')
					.style(webStyle(styles.panes))
					.children(
						list(parts),
						(parts.showSidebar || detailLayout.opened) &&
							h.section
								.class('design-detail')
								.attr('aria-label', 'Detail')
								.style({...webStyle(styles.pane), overflowY: 'auto'})
								.children(
									h.div
										.key(detailLayout.props.id ?? 'board')
										.style(webStyle(styles.detail))
										.children(
											Boolean.match(detailLayout.pending, {
												onFalse: () => paneChildren(options.detail),
												onTrue: () => [Skeleton(h, '46%', '20px'), Skeleton(h, '72%', '14px')]
											})
										)
								)
					),
				options.sheet !== undefined && Sheet<M, R>(h, options.sheet)
			)
	})
}

export function DetailText<M>(h: Html.H<M>, title: string, body: string, figure: string) {
	return [
		h.h1.style({...webStyle(styles.heading), margin: '0'}).children(title),
		h.p.style({...webStyle(styles.body), margin: '0'}).children(body),
		h.p
			.style({
				...webStyle(styles.line),
				...FIGURES,
				fontFamily: '"SF Mono", "Geist Mono Variable", monospace',
				margin: '0'
			})
			.children(figure)
	]
}
