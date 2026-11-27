// fallow-ignore-file unused-export unused-type -- New design entry point; apps keep their existing renderer until migration.
// The Fabric app starts without React Native's JS environment; Pressable uses its microtask queue.
import 'react-native/Libraries/Core/setUpTimers'

import {Native} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'

import {Array, Option} from 'effect'

import {ListModel, RowModel} from '../shared/model.ts'
import type {ListParts, RowData, Selection} from '../shared/model.ts'
import {black, fold, selected, status, styles} from '../shared/styles.ts'
import type {SheetData} from '../shared/styles.ts'

export type {RowData, Selection} from '../shared/model.ts'

function native<Tag extends string>(tag: Tag, viewName: string) {
	return Native.defineView(() => new Native.ViewElement<never, never, Record<string, unknown>, Tag>(tag), {viewName})
}

// These are the linked Fabric views from react-native-screens and react-native-safe-area-context;
// importing their React components would bring React into the application's JS bundle.
const Stack = native('designStack', 'RNSScreenStack')
const Screen = native('designScreen', 'RNSScreen')
const Header = native('designHeader', 'RNSScreenStackHeaderConfig')
const SafeArea = native('designSafeArea', 'RNCSafeAreaView')

const screenStyle = {
	position: 'absolute',
	top: 0,
	bottom: 0,
	left: 0,
	right: 0,
	backgroundColor: black
} as const satisfies Native.ViewStyle
const figures = ['tabular-nums'] as const
const pressedStyle = {backgroundColor: '#2b2b2b'}
// The system column overlays Fabric on Duo. Keep content out of its way,
// while the open screen's list still meets the fold.
const systemColumnWidth = 76

function Row<M>(h: Native.H<M>, data: RowData, parts: ListParts, select: Selection['select']) {
	const active = parts.wide && !parts.listHidden && Option.exists(parts.note, open => open.id === data.id)
	return RowModel(h, {
		key: data.id,
		props: data,
		view: row =>
			Pressable(h, {
				element: select(select(h.view, 'accessibilityTap', data.id), 'press', data.id),
				props: {pressedStyle}
			})
				.prop('accessible', true)
				.prop('accessibilityRole', 'button')
				.prop('accessibilityState', {selected: active})
				.prop(
					'accessibilityLabel',
					row.title + ', ' + row.line + (row.trailing === undefined ? '' : ', ' + row.trailing)
				)
				.style({...styles.row, backgroundColor: active ? selected : black})
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
					row.trailing !== undefined && h.text.style({...styles.line, fontVariant: figures}).children(row.trailing)
				)
	})
}

function Sheet<M>(h: Native.H<M>, parts: ListParts, options: SheetData) {
	return parts
		.dismissSheet(
			Screen.key('sheet')
				.style({...screenStyle, backgroundColor: styles.sheet.backgroundColor})
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
						props: {pressedStyle}
					})
						.style(styles.control)
						.prop('accessible', true)
						.prop('accessibilityRole', 'button')
						.prop('accessibilityLabel', options.action)
						.children(h.text.style(styles.body).children(options.action))
				)
			),
			Header.prop('hidden', true)
		)
}

function header(parts: ListParts, sheet: SheetData, detail: boolean) {
	return parts.toolbar(
		Header.prop('title', '')
			.prop('hideShadow', true)
			.prop('translucent', false)
			.prop('backgroundColor', black)
			.prop('color', '#fff')
			.prop('userInterfaceStyle', 'dark')
			.prop('backButtonDisplayMode', 'minimal')
			.prop('hidden', !detail && !parts.wide)
			.prop(
				'headerLeftBarButtonItems',
				parts.wide && parts.opened
					? [
							{
								index: 0,
								sfSymbolName: 'sidebar.left',
								buttonId: 'sidebar',
								accessibilityLabel: parts.listHidden ? 'Show list' : 'Hide list'
							}
						]
					: []
			)
			.prop(
				'headerRightBarButtonItems',
				parts.opened
					? [{index: 0, sfSymbolName: 'arrow.clockwise', buttonId: 'sheet', accessibilityLabel: sheet.title}]
					: []
			),
		'pressHeaderBarButtonItem'
	)
}

function Skeleton<M>(h: Native.H<M>, width: Native.ViewStyle['width'], height: number) {
	return h.view.style({width, height, backgroundColor: '#202020', borderRadius: 4})
}

export function ListDetail<M, R>(
	h: Native.H<M>,
	options: {
		rows: readonly RowData[]
		selection: Selection
		loading?: boolean
		detail: (row: RowData) => Native.NoTextInput<M, R>
		sheet: SheetData
	}
) {
	function detail(row: RowData, wide: boolean) {
		return h.scroll
			.key(row.id)
			.style(styles.pane)
			.contentContainerStyle({...styles.detail, paddingRight: systemColumnWidth, paddingTop: wide ? 44 : 20})
			.prop('contentInsetAdjustmentBehavior', 'never')
			.children(options.detail(row))
	}

	function detailSkeleton(wide: boolean) {
		return h.view
			.style({...styles.detail, flex: 1, paddingTop: wide ? 44 : 20})
			.children(Skeleton(h, '46%', 20), Skeleton(h, '72%', 14))
	}

	return ListModel(h, {
		props: {id: options.selection.id, rows: options.rows},
		view: parts => {
			const pendingDetail = options.loading === true && options.selection.id !== undefined
			return parts.layout(h.view.style(styles.frame), 'layout').children(
				Stack.style(styles.frame)
					.prop('nativeContainerBackgroundColor', black)
					.children(
						Screen.key('list')
							.style(screenStyle)
							.prop('activityState', 2)
							.prop('screenId', 'list')
							.children(
								SafeArea.style(styles.frame)
									.prop('edges', {top: 'additive', left: 'additive', right: 'additive', bottom: 'additive'})
									.children(
										h.view.style(styles.panes).children(
											h.scroll
												.style(
													parts.wide
														? {
																width: parts.splitWidth,
																display: parts.listHidden ? 'none' : 'flex',
																borderRightColor: fold,
																borderRightWidth: 1
															}
														: styles.pane
												)
												.contentContainerStyle(
													parts.wide
														? {...styles.rows, paddingTop: 32}
														: {...styles.rows, paddingRight: systemColumnWidth}
												)
												.prop('contentInsetAdjustmentBehavior', 'never')
												.children(
													options.loading === true
														? Array.makeBy(3, index =>
																h.view
																	.key(index)
																	.style({
																		...styles.row,
																		alignItems: 'flex-start',
																		justifyContent: 'center',
																		flexDirection: 'column',
																		gap: 6
																	})
																	.children(Skeleton(h, '36%', 12), Skeleton(h, '52%', 10))
															)
														: Array.map(options.rows, row => Row(h, row, parts, options.selection.select))
												),
											parts.wide &&
												Option.match(parts.note, {
													onNone: () => (pendingDetail ? detailSkeleton(true) : h.view.style(styles.pane)),
													onSome: row => detail(row, true)
												})
										)
									),
								header(parts, options.sheet, false)
							),
						!parts.wide &&
							(parts.opened || pendingDetail) &&
							options.selection
								.back(
									Screen.key('detail').style(screenStyle).prop('activityState', 2).prop('screenId', 'detail'),
									'dismissed'
								)
								.children(
									SafeArea.style(styles.frame)
										.prop('edges', {top: 'additive', left: 'additive', right: 'additive', bottom: 'additive'})
										.children(
											Option.match(parts.note, {onNone: () => detailSkeleton(false), onSome: row => detail(row, false)})
										),
									header(parts, options.sheet, true)
								),
						parts.opened && parts.sheetOpen && Sheet(h, parts, options.sheet)
					)
			)
		}
	})
}

export function DetailText<M>(h: Native.H<M>, title: string, body: string, figure: string) {
	return [
		h.text.style(styles.heading).prop('accessibilityRole', 'header').children(title),
		h.text.style(styles.body).children(body),
		h.text.style({...styles.line, fontFamily: 'ui-monospace', fontVariant: figures}).children(figure)
	]
}
