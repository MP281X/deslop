import {Array, DateTime, Duration, Number, Option, pipe} from 'effect'

export const HOUR = Duration.hours(1)
const HOUR_MS = Duration.toMillis(HOUR)

export type Reading = {from: DateTime.Utc; time: DateTime.Utc; value: Option.Option<number>}

// Every trace and marker maps timestamps onto exactly the same rolling hour.
export function axisPosition(at: DateTime.Utc, now: DateTime.Utc) {
	return (1 - (DateTime.toEpochMillis(now) - DateTime.toEpochMillis(at)) / HOUR_MS) * 100
}

export function restartPositions(restarts: readonly DateTime.Utc[], now: DateTime.Utc) {
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
export function tracePaths(readings: readonly Reading[], now: DateTime.Utc) {
	const paths = Array.reduce(readings, {area: '', lastRight: -1, line: ''}, (last, reading) => {
		const left = Number.max(0, axisPosition(reading.from, now))
		const right = Number.min(100, axisPosition(reading.time, now))
		if (right <= left) return last
		return Option.match(reading.value, {
			onNone: () => last,
			onSome: value => {
				const y = 100 - Number.clamp(value, {maximum: 100, minimum: 0})
				if (left === last.lastRight) {
					return {area: `${last.area}V${y}H${right}`, lastRight: right, line: `${last.line}V${y}H${right}`}
				}
				return {
					area: `${closeArea(last.area)}M${left} 100V${y}H${right}`,
					lastRight: right,
					line: `${last.line}M${left} ${y}H${right}`
				}
			}
		})
	})
	return {area: closeArea(paths.area), line: paths.line}
}
