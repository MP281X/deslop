import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'

import {Array, Boolean, Function, Layer, Option} from 'effect'

import type {PaneLeaf} from '@deslop/components/model'
import {Row, black, ink, selected, status, styles} from '@deslop/components/native'
import {nativeComponents} from '@deslop/components/native/components'
import {layerIPhoneShell} from '@deslop/runtime/iphone/shell'

import {scopeApp} from '#app'
import type {ScopeScreen} from '#app'
import {ScopeRoute, layerScope, levelOf} from '#reads'
import {Workspace} from '#view'
import type {ScopeUi} from '#view'

import {BAR, LANE, SCALE, SKELETON_BARS} from '#traces/screen.ts'
import type {Chart, SpanDetail} from '#traces/screen.ts'

const SCALE_STYLE = {
	color: styles.line.color,
	fontFamily: 'ui-monospace',
	fontSize: SCALE,
	fontVariant: ['tabular-nums'],
	lineHeight: 16
} as const satisfies Native.TextStyle

function Waterfall<M>(h: Native.H<M>, screen: ScopeScreen, chart: Chart) {
	return h.view.style({gap: 3, marginInline: 8}).children(
		h.view
			.style({flexDirection: 'row', justifyContent: 'space-between', paddingTop: 3})
			.prop('accessibilityElementsHidden', true)
			.children(Array.map(chart.ticks, tick => h.text.key(`${tick.ratio}`).style(SCALE_STYLE).children(tick.label))),
		screen
			.resize(h.view, 'layout')
			.style({height: chart.height, position: 'relative'})
			.prop('accessibilityLabel', 'Spans')
			.children(
				Array.map(chart.bars, bar =>
					Pressable(h, {
						element: screen.selectSpan(
							screen.selectSpan(h.view, 'accessibilityTap', bar.span.spanId),
							'press',
							bar.span.spanId
						),
						props: {pressedStyle: {opacity: 0.68}}
					})
						.key(`${bar.span.traceId}:${bar.span.spanId}`)
						.prop('accessible', true)
						.prop('accessibilityRole', 'button')
						.prop('accessibilityLabel', bar.description)
						.prop('accessibilityState', {selected: bar.selected})
						.style({height: BAR, left: bar.hit.left, position: 'absolute', top: bar.lane * LANE, width: bar.hit.width})
						.children(
							h.view
								.style({
									alignItems: 'flex-start',
									backgroundColor: Boolean.match(bar.failed, {
										onFalse: Function.constant(selected),
										onTrue: Function.constant(status.error)
									}),
									borderColor: ink,
									borderWidth: Boolean.match(bar.selected, {
										onFalse: Function.constant(0),
										onTrue: Function.constant(1)
									}),
									height: BAR,
									justifyContent: 'center',
									left: bar.left - bar.hit.left,
									overflow: 'hidden',
									position: 'absolute',
									width: bar.bar
								})
								.prop('pointerEvents', 'none')
								.children(
									bar.inside &&
										h.text
											.style({
												...SCALE_STYLE,
												color: Boolean.match(bar.failed, {
													onFalse: Function.constant(ink),
													onTrue: Function.constant(black)
												}),
												paddingInline: 5
											})
											.prop('numberOfLines', 1)
											.children(bar.label)
								),
							bar.after &&
								h.text
									.style({
										...SCALE_STYLE,
										color: ink,
										left: bar.left - bar.hit.left + bar.bar + 4,
										position: 'absolute',
										top: 3
									})
									.prop('numberOfLines', 1)
									.children(bar.label)
						)
				)
			)
	)
}

function Diagnostics<M>(h: Native.H<M>, screen: ScopeScreen, span: SpanDetail) {
	return h.view.style({gap: 8, marginTop: 8}).children(
		Row<M, never>(h, {active: false, item: span.row}),
		Option.getOrUndefined(
			Option.map(span.failure, error =>
				h.view
					.style({gap: 3, paddingInline: 12})
					.children(
						h.text.style(styles.title).children(error.title),
						h.text.style({...styles.line, color: status.error}).children(error.message)
					)
			)
		),
		h.view.style({gap: 4, paddingInline: 12}).children(
			Array.map(span.fields, field => {
				const value = h.text.style({...styles.line, color: ink, textAlign: 'right'})
				return h.view
					.key(field.id)
					.style({flexDirection: 'row', gap: 12})
					.children(
						h.text.style({...styles.line, flex: 1, minWidth: 0}).children(field.label),
						h.view.style({flex: 1.35, minWidth: 0}).children(
							Option.match(Option.fromUndefinedOr(field.url), {
								onNone: () => value.children(field.value),
								onSome: url =>
									Pressable(h, {
										element: screen.openLink(screen.openLink(h.view, 'accessibilityTap', url), 'press', url),
										props: {pressedStyle: {opacity: 0.68}}
									})
										.prop('accessible', true)
										.prop('accessibilityRole', 'link')
										.children(value.style({textDecorationLine: 'underline'}).children(field.value))
							})
						)
					)
			})
		),
		Array.isReadonlyArrayNonEmpty(span.logs) &&
			h.view
				.prop('accessibilityLabel', 'Span logs')
				.style({gap: 4, paddingInline: 12})
				.children(
					Array.map(span.logs, log =>
						h.view
							.key(log.id)
							.style({flexDirection: 'row', gap: 12})
							.children(
								h.text.style(SCALE_STYLE).children(log.time),
								h.text
									.style({
										...SCALE_STYLE,
										color: Boolean.match(log.failed, {
											onFalse: Function.constant(ink),
											onTrue: Function.constant(status.error)
										}),
										flex: 1,
										minWidth: 0
									})
									.children(log.text)
							)
					)
				)
	)
}

function Skeleton<M>(h: Native.H<M>) {
	const bone = {backgroundColor: styles.control.backgroundColor, borderRadius: 3, height: 12} as const
	return h.view
		.prop('accessibilityLabel', 'Loading trace')
		.prop('accessibilityState', {busy: true})
		.style({gap: 10, paddingInline: 8})
		.children(
			h.view.style({...bone, width: '32%'}),
			h.view
				.style({height: 3 * LANE + BAR, position: 'relative'})
				.children(
					Array.map(SKELETON_BARS, bar =>
						h.view.key(`${bar.top}:${bar.left}`).style({...bone, ...bar, height: BAR, position: 'absolute'})
					)
				),
			h.view.style({...bone, width: '48%'}),
			h.view.style({...bone, width: '25%'})
		)
}

function Problem<M>(h: Native.H<M>, text: string, action?: {label: string; press: ScopeScreen['retry']}) {
	return h.view.style({gap: 8, padding: 12}).children(
		h.text.style(styles.line).children(text),
		action !== undefined &&
			Pressable(h, {
				element: action.press(action.press(h.view, 'accessibilityTap'), 'press'),
				props: {pressedStyle: {backgroundColor: selected}}
			})
				.prop('accessibilityRole', 'button')
				.prop('accessible', true)
				.style({alignSelf: 'flex-start', paddingBlock: 10, paddingInline: 12})
				.children(h.text.style(styles.body).children(action.label))
	)
}

const drawing: ScopeUi<Native.H<never>, PaneLeaf<Native.NoTextInput<never>>, View.Content<never>> = {
	...nativeComponents<never>(),
	chart: Waterfall,
	diagnostics: Diagnostics,
	entry: (_h, _id, _title, row) => row,
	leaves: false,
	list: (h, options) => {
		if (options.traces === undefined) return options.operations
		return [
			h.scroll.style({height: 216}).children(options.operations),
			h.view.style({marginTop: 12}).children(options.traces)
		]
	},
	loading: Skeleton,
	note: (h, text, listed) =>
		h.text
			.style(Boolean.match(listed, {onFalse: () => styles.line, onTrue: () => ({...styles.line, padding: 12})}))
			.children(text),
	problem: Problem,
	trace: (h, options) =>
		h.view.children(
			options.summary,
			options.chart ?? h.text.style(styles.line).children('No spans'),
			options.diagnostics
		)
}

const App = scopeApp(true)(Native.vocabulary, (h, screen) => Workspace(h, screen, drawing))

NativeApp.register(
	Layer.provide(
		NativeApp.mount(App, Router.props(ScopeRoute)),
		Layer.provideMerge(
			layerScope,
			layerIPhoneShell({name: 'scope', replace: route => levelOf(route.search) > 0, route: ScopeRoute})
		)
	)
)
