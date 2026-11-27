import type {Native} from '@effect/ui-native'

import {Array, Number, String} from 'effect'
import type {DateTime} from 'effect'

import {fold, ink, status, styles} from '@deslop/design/native'

import {historyTrace, levels, ruler, traceSegments} from '#screens/chart.ts'
import type {Reading} from '#screens/chart.ts'

const position = 'absolute'
const muted = styles.line.color
const scale = {...styles.line, fontFamily: 'ui-monospace', fontSize: 10}

function Trace<M>(h: Native.H<M>, readings: readonly Reading[], now: DateTime.Utc, spark = false) {
	const points = traceSegments(readings, now)
	const color = spark ? muted : ink
	return Array.map(points, (point, i) => {
		const previous = points[i - 1]
		const left = `${point.left}%` as const
		return h.view
			.key(String.String(i))
			.style({position, inset: 0})
			.children(
				!spark &&
					h.view.style({
						position,
						left,
						top: `${point.y}%`,
						bottom: 0,
						width: `${point.right - point.left}%`,
						backgroundColor: '#ffffff0f'
					}),
				h.view.style({
					position,
					left,
					top: `${point.y}%`,
					width: `${point.right - point.left}%`,
					height: 1,
					backgroundColor: color
				}),
				previous !== undefined &&
					previous.right === point.left &&
					h.view.style({
						position,
						left,
						width: 1,
						backgroundColor: color,
						top: `${Number.min(previous.y, point.y)}%`,
						height: `${Number.max(previous.y, point.y) - Number.min(previous.y, point.y)}%`
					})
			)
	})
}

export function Sparkline<M>(h: Native.H<M>, readings: readonly Reading[], now: DateTime.Utc) {
	return h.view
		.style({width: 36, height: 18, flexShrink: 0, overflow: 'hidden'})
		.children(Trace(h, readings, now, true))
}

export function History<M>(
	h: Native.H<M>,
	readings: readonly Reading[],
	restarts: readonly DateTime.Utc[],
	now: DateTime.Utc
) {
	const trace = historyTrace(readings, restarts, now)
	return h.view.style({gap: 8, marginVertical: 4}).children(
		h.text.style(styles.line).children('CPU · Past hour'),
		trace.point === undefined && Array.isArrayEmpty(trace.restarts)
			? h.text.style(styles.line).children('No CPU readings in the last hour')
			: h.view.style({paddingRight: 32}).children(
					h.view.style({height: 96}).children(
						Array.map(levels, (level, index) =>
							h.view
								.key(String.String(level))
								.style({position, inset: 0})
								.children(
									h.view.style({position, left: 0, right: 0, top: `${index * 25}%`, height: 1, backgroundColor: fold}),
									h.view.style({position, top: 0, bottom: 0, left: `${index * 25}%`, width: 1, backgroundColor: fold}),
									h.text
										.style({
											...scale,
											position,
											left: '100%',
											marginLeft: 4,
											top: `${index * 25}%`,
											marginTop: -9,
											width: 30
										})
										.children(`${level}%`)
								)
						),
						Trace(h, readings, now),
						Array.map(trace.restarts, (at, index) =>
							h.view
								.key(`restart-${index}`)
								.style({position, left: `${at}%`, top: 0, bottom: 0, width: 1, backgroundColor: status.error})
						),
						trace.point !== undefined &&
							h.view.style({
								position,
								backgroundColor: ink,
								borderRadius: 3,
								width: 5,
								height: 5,
								left: `${trace.point.left}%`,
								top: `${trace.point.top}%`,
								marginTop: -2,
								marginLeft: -2
							})
					),
					h.view
						.style({flexDirection: 'row', justifyContent: 'space-between', marginTop: 8})
						.children(Array.map(ruler, label => h.text.key(label).style(scale).children(label)))
				)
	)
}
