// Pressable uses the microtask queue from React Native's bootstrap.
import 'react-native/Libraries/Core/setUpTimers'

import {Native} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'

import {Array, Boolean, Function, Option, Predicate} from 'effect'

import {ListModel, RowModel, listToolbar, paneChildren, sidebarId} from '#src/shared/model.ts'
import type {
	LayoutOptions,
	ListOptions,
	ListParts,
	RowOptions,
	SheetOptions,
	ToolbarAction,
	ToolbarOptions
} from '#src/shared/model.ts'
import {black, fold, selected, status, styles} from '#src/shared/styles.ts'

export {black, fold, ink, selected, status, styles} from '#src/shared/styles.ts'

const FIGURES = ['tabular-nums'] as const
const PRESSED_STYLE = {backgroundColor: '#2b2b2b'}
// The Duo system column overlays Fabric.
const SYSTEM_COLUMN_WIDTH = 76
const SCREEN_STYLE = {
	backgroundColor: black,
	bottom: 0,
	left: 0,
	position: 'absolute',
	right: 0,
	top: 0
} as const satisfies Native.ViewStyle

type NativeView<Tag extends string> = <M>() => Native.ViewElement<M, never, Record<string, unknown>, Tag>

function native<Tag extends string>(tag: Tag, viewName: string) {
	// The registered builder has no handlers until a component adds its own.
	const view: NativeView<Tag> = Function.constant(
		Native.defineView(() => new Native.ViewElement<never, never, Record<string, unknown>, Tag>(tag), {viewName})
	)
	return view
}

// Use the linked Fabric views without importing their React components.
const Stack = native('designStack', 'RNSScreenStack')
const Screen = native('designScreen', 'RNSScreen')
const Header = native('designHeader', 'RNSScreenStackHeaderConfig')
const SafeArea = native('designSafeArea', 'RNCSafeAreaView')

export function Row<M, R>(h: Native.H<M>, options: RowOptions<Native.NoTextInput<M, R>>) {
	const {active, item, select} = options
	const title = {
		...styles.title,
		color: Boolean.match(options.muted === true, {
			onTrue: Function.constant(styles.line.color),
			onFalse: Function.constant(styles.title.color)
		})
	}
	return RowModel(h, {
		key: item.id,
		props: item,
		view: row => {
			const trailing = Boolean.match(row.trailing === undefined, {
				onFalse: () => `, ${row.trailing}`,
				onTrue: Function.constant('')
			})
			const element = Option.match(Option.fromUndefinedOr(select), {
				onNone: () => h.view,
				onSome: pick =>
					Pressable(h, {
						element: pick(pick(h.view, 'accessibilityTap', item.id), 'press', item.id),
						props: {pressedStyle: PRESSED_STYLE}
					})
						.prop('accessible', true)
						.prop('accessibilityRole', 'button')
						.prop('accessibilityState', {selected: active})
						.prop('accessibilityLabel', `${row.title}, ${row.line}${trailing}`)
			})
			return element
				.style({
					...styles.row,
					backgroundColor: Boolean.match(active, {
						onFalse: Function.constant(black),
						onTrue: Function.constant(selected)
					})
				})
				.children(
					options.cover,
					h.view
						.style(styles.lead)
						.children(
							h.view
								.style(styles.titleLine)
								.children(
									row.status !== undefined && h.view.style({...styles.dot, backgroundColor: status[row.status]}),
									h.text.style(title).prop('numberOfLines', 1).children(row.title)
								),
							h.text.style(styles.line).prop('numberOfLines', 1).children(row.line)
						),
					options.trailing ??
						(row.trailing !== undefined && h.text.style({...styles.line, fontVariant: FIGURES}).children(row.trailing))
				)
		}
	})
}

export function Sheet<M, R>(h: Native.H<M>, options: SheetOptions<Native.NoTextInput<M, R>>) {
	if (!options.open) return undefined
	const sheet = Screen<M>()
		.key('sheet')
		.style({...SCREEN_STYLE, backgroundColor: styles.sheet.backgroundColor})
		.prop('activityState', 2)
		.prop('screenId', 'sheet')
		.prop('stackPresentation', 'formSheet')
		.prop('sheetAllowedDetents', [options.height ?? 0.4])
		.prop('sheetGrabberVisible', options.pending !== true)
		.prop('gestureEnabled', options.pending !== true)
	const body = h.view
		.style({
			...styles.sheet,
			flex: 1,
			paddingTop: Boolean.match(options.toolbar === undefined, {
				onTrue: Function.constant(24),
				onFalse: Function.constant(80)
			})
		})
		.prop('accessibilityLabel', options.label)
		.children(
			h.scroll.style(styles.pane).prop('automaticallyAdjustKeyboardInsets', true).children(options.body),
			options.actions !== undefined && h.view.style(styles.sheetActions).children(options.actions)
		)
	const element = Boolean.match(options.pending === true, {
		onTrue: () => sheet,
		onFalse: () => options.dismiss(sheet, 'dismissed')
	})
	if (options.toolbar === undefined) return element.children(body)
	return element.children(
		Stack<M>()
			.style(styles.frame)
			.prop('nativeContainerBackgroundColor', styles.sheet.backgroundColor)
			.children(screen<M>('sheet-content').children(body, header<M>(options.toolbar, true)))
	)
}

function nativeAction(action: ToolbarAction, index: number) {
	const button = {
		accessibilityLabel: action.label,
		disabled: action.disabled === true,
		index,
		sfSymbolName: action.symbol
	}
	if (action.menu === undefined) return {...button, buttonId: action.id}
	return {
		...button,
		menu: {
			title: '',
			items: Array.map(action.menu, entry => ({
				disabled: entry.disabled,
				menuId: entry.id,
				sfSymbolName: entry.symbol,
				state: Boolean.match(entry.checked === true, {
					onTrue: Function.constant('on'),
					onFalse: Function.constant('off')
				}),
				title: entry.label
			}))
		}
	}
}

function header<M>(toolbar: ToolbarOptions | undefined, visible: boolean) {
	const bar = Header<M>()
		.prop('title', '')
		.prop('hideShadow', true)
		.prop('translucent', false)
		.prop('backgroundColor', black)
		.prop('color', '#fff')
		.prop('userInterfaceStyle', 'dark')
		.prop('backButtonDisplayMode', 'minimal')
		.prop('hidden', !visible)
	if (toolbar === undefined) return bar
	return toolbar.choose(
		toolbar.choose(
			bar.prop('headerRightBarButtonItems', Array.map(toolbar.actions, nativeAction)),
			'pressHeaderBarButtonItem',
			value => {
				if (!Predicate.hasProperty(value, 'buttonId')) return undefined
				return Option.map(
					Array.findFirst(
						toolbar.actions,
						item => item.id === value.buttonId && item.menu === undefined && item.disabled !== true
					),
					item => item.id
				).pipe(Option.getOrUndefined)
			}
		),
		'pressHeaderBarButtonMenuItem',
		value => {
			if (!Predicate.hasProperty(value, 'menuId')) return undefined
			const items = Array.flatMap(toolbar.actions, action => action.menu ?? [])
			return Option.map(
				Array.findFirst(items, item => item.id === value.menuId && item.disabled !== true),
				item => item.id
			).pipe(Option.getOrUndefined)
		}
	)
}

export function Toolbar<M>(_h: Native.H<M>, toolbar: ToolbarOptions) {
	return header<M>(toolbar, true)
}

function chrome<M>(parts: ListParts, toolbar: ToolbarOptions | undefined, detail: boolean) {
	return parts.toolbar(
		header<M>(toolbar, detail || parts.wide || (toolbar?.actions.length ?? 0) > 0).prop(
			'headerLeftBarButtonItems',
			Boolean.match(parts.showSidebar, {
				onFalse: Array.empty,
				onTrue: () => [
					{accessibilityLabel: parts.listAction, buttonId: sidebarId, index: 0, sfSymbolName: 'sidebar.left'}
				]
			})
		),
		'pressHeaderBarButtonItem'
	)
}

function Skeleton<M>(h: Native.H<M>, width: Native.ViewStyle['width'], height: number) {
	return h.view.style({backgroundColor: '#202020', borderRadius: 4, height, width})
}

function screen<M>(id: string) {
	return Screen<M>().key(id).style(SCREEN_STYLE).prop('activityState', 2).prop('screenId', id)
}

function listArea<M>() {
	return SafeArea<M>()
		.style(styles.frame)
		.prop('edges', {bottom: 'additive', left: 'additive', right: 'additive', top: 'additive'})
}

function detailTop(wide: boolean) {
	if (wide) return 44
	return 20
}

function listStyle(parts: ListParts) {
	if (!parts.showSidebar) return styles.pane
	return {
		borderRightColor: fold,
		borderRightWidth: 1,
		display: Boolean.match(parts.listHidden, {
			onFalse: Function.constant('flex' as const),
			onTrue: Function.constant('none' as const)
		}),
		width: parts.splitWidth
	} satisfies Native.ViewStyle
}

function RowSkeleton<M>(h: Native.H<M>, index: number) {
	return h.view
		.key(`${index}`)
		.style({...styles.row, alignItems: 'flex-start', flexDirection: 'column', gap: 6, justifyContent: 'center'})
		.children(Skeleton(h, '36%', 12), Skeleton(h, '52%', 10))
}

export function Layout<M, R>(
	h: Native.H<M>,
	options: LayoutOptions<Native.NoTextInput<M, R>> & {content: Native.NoTextInput<M, R>}
) {
	return Stack<M>()
		.style(styles.frame)
		.prop('nativeContainerBackgroundColor', black)
		.children(
			screen<M>('layout').children(options.content, header<M>(options.toolbar, options.toolbar !== undefined)),
			options.sheet !== undefined && Sheet(h, options.sheet)
		)
}

export function ListDetail<M, R>(h: Native.H<M>, options: ListOptions<Native.NoTextInput<M, R>>) {
	const id = options.selection.id
	const pending = options.loading === true && id !== undefined && options.detail === undefined
	const hasDetail = options.detail !== undefined || pending
	const opened = id !== undefined && hasDetail

	function detail(wide: boolean) {
		return h.scroll
			.key(id ?? 'board')
			.style(styles.pane)
			.contentContainerStyle({...styles.detail, paddingRight: SYSTEM_COLUMN_WIDTH, paddingTop: detailTop(wide)})
			.prop('contentInsetAdjustmentBehavior', 'never')
			.children(
				Boolean.match(pending, {
					onTrue: () => [Skeleton(h, '46%', 20), Skeleton(h, '72%', 14)],
					onFalse: () => paneChildren(options.detail)
				})
			)
	}

	function list(parts: ListParts) {
		return h.scroll
			.style(listStyle(parts))
			.contentContainerStyle({
				...styles.rows,
				paddingRight: parts.wide ? styles.rows.padding : SYSTEM_COLUMN_WIDTH,
				paddingTop: parts.wide ? 32 : styles.rows.padding
			})
			.prop('contentInsetAdjustmentBehavior', 'never')
			.children(
				options.header,
				Boolean.match(options.loading === true, {
					onFalse: () => paneChildren(options.list?.(parts.activeId, parts.wide) ?? options.empty),
					onTrue: () => Array.makeBy(3, index => RowSkeleton(h, index))
				})
			)
	}

	return ListModel(h, {
		props: {defaultId: options.defaultId, hasDetail, id},
		view: parts =>
			parts.layout(h.view.style(styles.frame), 'layout').children(
				Stack<M>()
					.style(styles.frame)
					.prop('nativeContainerBackgroundColor', black)
					.children(
						screen<M>('list').children(
							listArea<M>().children(h.view.style(styles.panes).children(list(parts), parts.showSidebar && detail(true))),
							chrome<M>(parts, listToolbar(options.toolbar, options.detailToolbar, parts.showSidebar, false), false)
						),
						!parts.wide &&
							opened &&
							options.selection
								.back(screen<M>('detail'), 'dismissed')
								.children(
									listArea<M>().children(detail(false)),
									chrome<M>(parts, listToolbar(options.toolbar, options.detailToolbar, false, true), true)
								),
						options.sheet !== undefined && Sheet(h, options.sheet)
					)
			)
	})
}

export function DetailText<M>(h: Native.H<M>, title: string, body: string, figure: string) {
	return [
		h.text.style(styles.heading).prop('accessibilityRole', 'header').children(title),
		h.text.style(styles.body).children(body),
		h.text.style({...styles.line, fontFamily: 'ui-monospace', fontVariant: FIGURES}).children(figure)
	]
}
