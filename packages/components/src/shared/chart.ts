import {Array, DateTime, Duration, Number, Option, pipe} from 'effect'

export const HOUR = Duration.hours(1)
const HOUR_MS = Duration.toMillis(HOUR)

export type Reading = {from: DateTime.Utc; time: DateTime.Utc; value: Option.Option<number>}

// Every trace and marker maps timestamps onto exactly the same rolling hour.
export function axisPosition(at: DateTime.Utc, now: DateTime.Utc) {
	return (1 - (DateTime.toEpochMillis(now) - DateTime.toEpochMillis(at)) / HOUR_MS) * 100
}

function restartPositions(restarts: readonly DateTime.Utc[], now: DateTime.Utc) {
	return pipe(
		restarts,
		Array.map(at => axisPosition(at, now)),
		Array.filter(x => x >= 0 && x <= 100)
	)
}

function closeArea(area: string) {
	if (area === '') return area
	return `${area}V100Z`
}

// Missing readings break a trace instead of showing a zero.
export function traceSegments(readings: readonly Reading[], now: DateTime.Utc) {
	return Array.flatMap(readings, reading => {
		const left = Number.max(0, axisPosition(reading.from, now))
		const right = Number.min(100, axisPosition(reading.time, now))
		if (right <= left) return []
		return pipe(
			reading.value,
			Option.map(value => ({left, right, y: 100 - Number.clamp(value, {maximum: 100, minimum: 0})})),
			Option.toArray
		)
	})
}

export function tracePaths(readings: readonly Reading[], now: DateTime.Utc) {
	const paths = Array.reduce(traceSegments(readings, now), {area: '', lastRight: -1, line: ''}, (last, point) => {
		if (point.left === last.lastRight) {
			return {
				area: `${last.area}V${point.y}H${point.right}`,
				lastRight: point.right,
				line: `${last.line}V${point.y}H${point.right}`
			}
		}
		return {
			area: `${closeArea(last.area)}M${point.left} 100V${point.y}H${point.right}`,
			lastRight: point.right,
			line: `${last.line}M${point.left} ${point.y}H${point.right}`
		}
	})
	return {area: closeArea(paths.area), line: paths.line}
}

export const ruler = ['−60m', '−45m', '−30m', '−15m', 'Now']
export const levels = [100, 75, 50, 25, 0]

export function historyTrace(readings: readonly Reading[], restarts: readonly DateTime.Utc[], now: DateTime.Utc) {
	const latest = Array.findLast(
		readings,
		reading =>
			Option.isSome(reading.value) && axisPosition(reading.time, now) > 0 && axisPosition(reading.from, now) < 100
	)
	return {
		point: pipe(
			latest,
			Option.flatMap(reading =>
				Option.map(reading.value, value => ({
					left: Number.min(100, axisPosition(reading.time, now)),
					top: 100 - Number.clamp(value, {maximum: 100, minimum: 0})
				}))
			),
			Option.getOrUndefined
		),
		restarts: restartPositions(restarts, now)
	}
}
