import {Array, Boolean, Duration, Function, Option, Order, Record, pipe} from 'effect'

import type {SpanId} from '#services/telemetry/schema.ts'

export type FlameSpan = {depth: number; durationMs: Duration.Duration; offsetMs: Duration.Duration; spanId: SpanId}

type Interval = {end: Duration.Duration; start: Duration.Duration}
type Lane = {intervals: readonly Interval[]; lastEnd: Option.Option<Duration.Duration>}

function byStart<T extends FlameSpan>() {
	return pipe(
		Duration.Order,
		Order.mapInput((span: T) => span.offsetMs),
		Order.combine(Order.mapInput(Order.flip(Duration.Order), (span: T) => span.durationMs))
	)
}

// A zero-length span occupies its instant, so it collides with an interval ending there.
function collides(span: FlameSpan, interval: Interval) {
	if (Duration.isZero(span.durationMs)) {
		return (
			Duration.isLessThanOrEqualTo(interval.start, span.offsetMs) &&
			Duration.isLessThanOrEqualTo(span.offsetMs, interval.end)
		)
	}
	return (
		Duration.isLessThan(span.offsetMs, interval.end) &&
		Duration.isLessThan(interval.start, Duration.sum(span.offsetMs, span.durationMs))
	)
}

// Labels reserve time in the same lane so later bars cannot cover them.
export function lanesOf<T extends FlameSpan>(
	spans: readonly T[],
	reservations: Record<SpanId, Duration.Duration> = {}
) {
	const root = Array.findFirst(spans, span => span.depth === 0)
	const jobs = pipe(
		spans,
		Array.filter(span => span.depth === 1),
		Array.sort(byStart<T>())
	)
	const rest = pipe(
		spans,
		Array.filter(span => span.depth > 1 || (span.depth === 0 && !Option.contains(root, span))),
		Array.sort(byStart<T>())
	)
	const initial = Array.appendAll(Option.toArray(root), jobs)
	const [, placed] = Array.mapAccum(
		rest,
		Array.map<T[], Lane>(initial, span => {
			const interval = {end: Duration.sum(span.offsetMs, span.durationMs), start: span.offsetMs}
			return {
				intervals: pipe(
					reservations,
					Record.get(span.spanId),
					Option.match({
						onNone: () => Array.make(interval),
						onSome: reserve => Array.make(interval, {end: Duration.sum(interval.end, reserve), start: interval.end})
					})
				),
				lastEnd: Option.none<Duration.Duration>()
			}
		}),
		(existing, span) => {
			const end = Duration.sum(span.offsetMs, span.durationMs)
			return pipe(
				existing,
				Array.findFirstIndex(
					lane =>
						Array.every(lane.intervals, interval => !collides(span, interval)) &&
						Option.match(lane.lastEnd, {
							onNone: Function.constTrue,
							onSome: previousEnd =>
								Boolean.match(Duration.isZero(span.durationMs), {
									onFalse: () => Duration.isLessThanOrEqualTo(previousEnd, span.offsetMs),
									onTrue: () => Duration.isLessThan(previousEnd, span.offsetMs)
								})
						})
				),
				Option.match({
					onNone: () =>
						[
							Array.append(existing, {intervals: [], lastEnd: Option.some(end)}),
							{lane: existing.length, span}
						] as const,
					onSome: lane =>
						[
							Array.map(existing, (current, index) => {
								if (index === lane) return {...current, lastEnd: Option.some(end)}
								return current
							}),
							{lane, span}
						] as const
				})
			)
		}
	)
	return pipe(
		initial,
		Array.map((span, lane) => ({lane, span})),
		Array.appendAll(placed)
	)
}
