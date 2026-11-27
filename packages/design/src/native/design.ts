// Pressable uses the microtask queue from React Native's bootstrap.
import 'react-native/Libraries/Core/setUpTimers'

import {Native} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'

import {Array, Boolean, Function, Option} from 'effect'

import {ListModel, RowModel, listProps} from '#src/shared/model.ts'
import type {ListOptions, ListParts, RowData, Selection} from '#src/shared/model.ts'
import {black, fold, selected, status, styles} from '#src/shared/styles.ts'
import type {SheetData} from '#src/shared/styles.ts'

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

function Row<M>(h: Native.H<M>, item: RowData, parts: ListParts, select: Selection['select']) {
	const active = parts.wide && !parts.listHidden && Option.exists(parts.note, open => open.id === item.id)
	return RowModel(h, {
		key: item.id,
		props: item,
		view: row => {
			const trailing = Boolean.match(row.trailing === undefined, {
				onFalse: () => `, ${row.trailing}`,
				onTrue: Function.constant('')
			})
			return Pressable(h, {
				element: select(select(h.view, 'accessibilityTap', item.id), 'press', item.id),
				props: {pressedStyle: PRESSED_STYLE}
			})
				.prop('accessible', true)
				.prop('accessibilityRole', 'button')
				.prop('accessibilityState', {selected: active})
				.prop('accessibilityLabel', `${row.title}, ${row.line}${trailing}`)
				.style({
					...styles.row,
					backgroundColor: Boolean.match(active, {
						onFalse: Function.constant(black),
						onTrue: Function.constant(selected)
					})
				})
				.children(
					h.view
						.style(styles.lead)
						.children(
							h.view
								.style(styles.titleLine)
								.children(
									row.status !== undefined && h.view.style({...styles.dot, backgroundColor: status[row.status]}),
									h.text.style(styles.title).prop('numberOfLines', 1).children(row.title)
								),
							h.text.style(styles.line).prop('numberOfLines', 1).children(row.line)
						),
					row.trailing !== undefined && h.text.style({...styles.line, fontVariant: FIGURES}).children(row.trailing)
				)
		}
	})
}

function Sheet<M>(h: Native.H<M>, parts: ListParts, options: SheetData) {
	return parts
		.dismissSheet(
			Screen<M>()
				.key('sheet')
				.style({...SCREEN_STYLE, backgroundColor: styles.sheet.backgroundColor})
				.prop('activityState', 2)
				.prop('screenId', 'sheet')
				.prop('stackPresentation', 'formSheet')
				.prop('sheetAllowedDetents', [0.4, 1])
				.prop('sheetGrabberVisible', true),
			'dismissed'
		)
		.children(
			h.view.style({...styles.sheet, flex: 1, paddingTop: 24}).children(
				h.text.style(styles.heading).prop('accessibilityRole', 'header').children(options.title),
				h.text.style(styles.body).children(options.body),
				h.view.style(styles.sheetActions).children(
					Pressable(h, {
						element: parts.dismissSheet(parts.dismissSheet(h.view, 'accessibilityTap'), 'press'),
						props: {pressedStyle: PRESSED_STYLE}
					})
						.style(styles.control)
						.prop('accessible', true)
						.prop('accessibilityRole', 'button')
						.prop('accessibilityLabel', options.action)
						.children(h.text.style(styles.body).children(options.action))
				)
			),
			Header<M>().prop('hidden', true)
		)
}

function header<M>(parts: ListParts, sheet: SheetData, detail: boolean) {
	return parts.toolbar(
		Header<M>()
			.prop('title', '')
			.prop('hideShadow', true)
			.prop('translucent', false)
			.prop('backgroundColor', black)
			.prop('color', '#fff')
			.prop('userInterfaceStyle', 'dark')
			.prop('backButtonDisplayMode', 'minimal')
			.prop('hidden', !detail && !parts.wide)
			.prop(
				'headerLeftBarButtonItems',
				Boolean.match(parts.wide && parts.opened, {
					onFalse: Array.empty,
					onTrue: () => [
						{accessibilityLabel: parts.listAction, buttonId: 'sidebar', index: 0, sfSymbolName: 'sidebar.left'}
					]
				})
			)
			.prop(
				'headerRightBarButtonItems',
				Boolean.match(parts.opened, {
					onFalse: Array.empty,
					onTrue: () => [
						{accessibilityLabel: sheet.title, buttonId: 'sheet', index: 0, sfSymbolName: 'arrow.clockwise'}
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
	if (!parts.wide) return styles.pane
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

export function ListDetail<M, R>(
	h: Native.H<M>,
	options: ListOptions & {detail: (row: RowData) => Native.NoTextInput<M, R>; sheet: SheetData}
) {
	function detail(row: RowData, wide: boolean) {
		return h.scroll
			.key(row.id)
			.style(styles.pane)
			.contentContainerStyle({...styles.detail, paddingRight: SYSTEM_COLUMN_WIDTH, paddingTop: detailTop(wide)})
			.prop('contentInsetAdjustmentBehavior', 'never')
			.children(options.detail(row))
	}

	function detailSkeleton(wide: boolean) {
		return h.view
			.style({...styles.detail, flex: 1, paddingTop: detailTop(wide)})
			.children(Skeleton(h, '46%', 20), Skeleton(h, '72%', 14))
	}

	function list(parts: ListParts) {
		return h.scroll
			.style(listStyle(parts))
			.contentContainerStyle(
				Boolean.match(parts.wide, {
					onFalse: () => ({...styles.rows, paddingRight: SYSTEM_COLUMN_WIDTH}),
					onTrue: () => ({...styles.rows, paddingTop: 32})
				})
			)
			.prop('contentInsetAdjustmentBehavior', 'never')
			.children(
				parts.rows(
					row => Row(h, row, parts, options.selection.select),
					index => RowSkeleton(h, index)
				)
			)
	}

	return ListModel(h, {
		props: listProps(options),
		view: parts =>
			parts.layout(h.view.style(styles.frame), 'layout').children(
				Stack<M>()
					.style(styles.frame)
					.prop('nativeContainerBackgroundColor', black)
					.children(
						screen<M>('list').children(
							listArea<M>().children(
								h.view
									.style(styles.panes)
									.children(
										list(parts),
										parts.wide &&
											Option.match(parts.note, {
												onNone: () =>
													Boolean.match(parts.pendingDetail, {
														onFalse: () => h.view.style(styles.pane),
														onTrue: () => detailSkeleton(true)
													}),
												onSome: row => detail(row, true)
											})
									)
							),
							header<M>(parts, options.sheet, false)
						),
						!parts.wide &&
							(parts.opened || parts.pendingDetail) &&
							options.selection
								.back(screen<M>('detail'), 'dismissed')
								.children(
									listArea<M>().children(
										Option.match(parts.note, {onNone: () => detailSkeleton(false), onSome: row => detail(row, false)})
									),
									header<M>(parts, options.sheet, true)
								),
						parts.opened && parts.sheetOpen && Sheet(h, parts, options.sheet)
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
