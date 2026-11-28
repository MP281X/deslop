import type {Native} from '@effect/ui-native'

import {Array, Number, String, Boolean, Function} from 'effect'
import type {DateTime} from 'effect'

import {fold, ink, status, styles} from './design.ts'

import {historyTrace, levels, ruler, traceSegments} from '#src/shared/chart.ts'
import type {Reading} from '#src/shared/chart.ts'
import type {HistoryOptions} from '#src/shared/components.ts'

const POSITION = 'absolute'
const muted = styles.line.color
const scale = {...styles.line, fontFamily: 'ui-monospace', fontSize: 10}

function Trace<M>(h: Native.H<M>, readings: readonly Reading[], now: DateTime.Utc, spark = false) {
	const points = traceSegments(readings, now)
	const color = Boolean.match(spark, {onFalse: Function.constant(ink), onTrue: Function.constant(muted)})
	return Array.map(points, (point, i) => {
		const previous = points[i - 1]
		const left = `${point.left}%` as const
		return h.view
			.key(String.String(i))
			.style({inset: 0, position: POSITION})
			.children(
				!spark &&
					h.view.style({
						backgroundColor: '#ffffff0f',
						bottom: 0,
						left,
						position: POSITION,
						top: `${point.y}%`,
						width: `${point.right - point.left}%`
					}),
				h.view.style({
					backgroundColor: color,
					height: 1,
					left,
					position: POSITION,
					top: `${point.y}%`,
					width: `${point.right - point.left}%`
				}),
				previous !== undefined &&
					previous.right === point.left &&
					h.view.style({
						backgroundColor: color,
						height: `${Number.max(previous.y, point.y) - Number.min(previous.y, point.y)}%`,
						left,
						position: POSITION,
						top: `${Number.min(previous.y, point.y)}%`,
						width: 1
					})
			)
	})
}

export function Sparkline<M>(h: Native.H<M>, readings: readonly Reading[], now: DateTime.Utc) {
	return h.view
		.style({flexShrink: 0, height: 18, overflow: 'hidden', width: 36})
		.children(Trace(h, readings, now, true))
}

export function History<M>(h: Native.H<M>, options: HistoryOptions) {
	const trace = historyTrace(options.readings, options.restarts, options.now)
	return h.view.style({gap: 8, marginVertical: 4}).children(
		h.text.style(styles.line).children(options.title),
		Boolean.match(trace.point === undefined && Array.isArrayEmpty(trace.restarts), {
			onFalse: () =>
				h.view.style({paddingRight: 32}).children(
					h.view.style({height: 96}).children(
						Array.map(levels, (level, index) =>
							h.view
								.key(String.String(level))
								.style({inset: 0, position: POSITION})
								.children(
									h.view.style({
										backgroundColor: fold,
										height: 1,
										left: 0,
										position: POSITION,
										right: 0,
										top: `${index * 25}%`
									}),
									h.view.style({
										backgroundColor: fold,
										bottom: 0,
										left: `${index * 25}%`,
										position: POSITION,
										top: 0,
										width: 1
									}),
									h.text
										.style({
											...scale,
											left: '100%',
											marginLeft: 4,
											marginTop: -9,
											position: POSITION,
											top: `${index * 25}%`,
											width: 30
										})
										.children(`${level}%`)
								)
						),
						Trace(h, options.readings, options.now),
						Array.map(trace.restarts, (at, index) =>
							h.view
								.key(`restart-${index}`)
								.style({backgroundColor: status.error, bottom: 0, left: `${at}%`, position: POSITION, top: 0, width: 1})
						),
						trace.point !== undefined &&
							h.view.style({
								backgroundColor: ink,
								borderRadius: 3,
								height: 5,
								left: `${trace.point.left}%`,
								marginLeft: -2,
								marginTop: -2,
								position: POSITION,
								top: `${trace.point.top}%`,
								width: 5
							})
					),
					h.view
						.style({flexDirection: 'row', justifyContent: 'space-between', marginTop: 8})
						.children(Array.map(ruler, label => h.text.key(label).style(scale).children(label)))
				),
			onTrue: () => h.text.style(styles.line).children(options.empty)
		})
	)
}
