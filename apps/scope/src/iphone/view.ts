import type {Native} from '@effect/ui-native'
import {Pressable} from '@effect/ui-native/kit'

import {Array, Boolean, Function, Match, Option, pipe} from 'effect'

import {ListDetail, Row, black, ink, selected, status, styles} from '@deslop/design/native'

import {scopeLayout} from '#screens/scope.ts'
import type {Screen} from '#screens/scope.ts'
import type {SpanDetail} from '#screens/span.ts'
import {BAR, LANE, SCALE, SKELETON_BARS} from '#screens/waterfall.ts'

type Detail = Extract<Screen['detail'], {state: 'ready'}>
const SCALE_STYLE = {
	color: styles.line.color,
	fontFamily: 'ui-monospace',
	fontSize: SCALE,
	fontVariant: ['tabular-nums'],
	lineHeight: 16
} as const satisfies Native.TextStyle

function Problem<M>(h: Native.H<M>, screen: Screen, problem: NonNullable<Screen['problem']>) {
	const retry = problem.action === 'retry'
	const action = Boolean.match(retry, {onFalse: () => screen.signIn, onTrue: () => screen.retry})
	return h.view.style({gap: 8, padding: 12}).children(
		h.text.style(styles.line).children(problem.text),
		problem.action !== undefined &&
			Pressable(h, {
				element: action(action(h.view, 'accessibilityTap'), 'press'),
				props: {pressedStyle: {backgroundColor: selected}}
			})
				.prop('accessibilityRole', 'button')
				.prop('accessible', true)
				.style({alignSelf: 'flex-start', paddingBlock: 10, paddingInline: 12})
				.children(
					h.text
						.style(styles.body)
						.children(Boolean.match(retry, {onFalse: Function.constant('Sign in'), onTrue: Function.constant('Retry')}))
				)
	)
}

function Waterfall<M>(h: Native.H<M>, screen: Screen, chart: Detail['chart']) {
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

function Diagnostics<M>(h: Native.H<M>, screen: Screen, span: SpanDetail) {
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

function Detail<M>(h: Native.H<M>, screen: Screen) {
	return pipe(
		screen.detail,
		Match.value,
		Match.discriminatorsExhaustive('state')({
			empty: trace => h.text.style(styles.line).children(trace.text),
			loading: () => Skeleton(h),
			problem: trace => Problem(h, screen, trace.problem),
			ready: trace =>
				h.view.children(
					Row<M, never>(h, {
						active: false,
						item: {id: 'trace-summary', line: trace.age, title: trace.title, trailing: trace.duration}
					}),
					Boolean.match(Array.isReadonlyArrayEmpty(trace.chart.bars), {
						onFalse: () => Waterfall(h, screen, trace.chart),
						onTrue: () => h.text.style(styles.line).children('No spans')
					}),
					Option.getOrUndefined(Option.map(trace.span, span => Diagnostics(h, screen, span)))
				)
		})
	)
}

export function Workspace<M>(h: Native.H<M>, screen: Screen) {
	const empty = h.text.style({...styles.line, padding: 12}).children('No operations')
	return ListDetail<M, never>(h, {
		// fallow-ignore-next-line code-duplication -- Web and iPhone pass the same screen parts; only each host's elements differ.
		...scopeLayout(screen, () => Detail(h, screen)),
		empty,
		list: (activeId, wide) => {
			if (screen.problem !== undefined) return Problem(h, screen, screen.problem)
			const operations = Array.map(screen.operations, row =>
				Row<M, never>(h, {active: row.item.id === activeId, item: row.item, select: screen.selection.select})
			)
			if (Array.isReadonlyArrayEmpty(operations)) return empty
			if (!wide || Array.isReadonlyArrayEmpty(screen.traces)) return operations
			return [
				h.scroll.style({height: 216}).children(operations),
				h.view
					.style({marginTop: 12})
					.children(
						Array.map(screen.traces, item =>
							Row<M, never>(h, {
								active: activeId !== undefined && item.id === screen.activeTrace,
								item,
								select: screen.selection.select
							})
						)
					)
			]
		}
	})
}
