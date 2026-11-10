import {Array, MutableList, Number, Option, Order, Record} from 'effect'

export type FlameSpan = {depth: number; durationMs: number; offsetMs: number; spanId: string}

function byStart<T extends FlameSpan>() {
	return Order.combine(
		Order.mapInput(Order.Number, (span: T) => span.offsetMs),
		Order.mapInput(Order.flip(Order.Number), (span: T) => span.durationMs)
	)
}

// The root's lane, then one lane per job, with the label's space kept free, then each deeper span in the first lane whose time is free; no two spans in a lane overlap.
export function lanesOf<T extends FlameSpan>(spans: readonly T[], reservations: Record<string, number> = {}) {
	const root = Option.getOrUndefined(Array.findFirst(spans, span => span.depth === 0))
	const jobs = Array.sort(
		Array.filter(spans, span => span.depth === 1),
		byStart<T>()
	)
	const rest = Array.sort(
		Array.filter(spans, span => span.depth > 1 || (span.depth === 0 && span !== root)),
		byStart<T>()
	)
	const placed = MutableList.make<{lane: number; span: T}>()
	const intervals = MutableList.make<{end: number; lane: number; start: number}>()
	function laneCount() {
		return Array.reduce(MutableList.toArray(placed), 0, (deepest, entry) => Number.max(deepest, entry.lane + 1))
	}
	function add(span: T, lane: number) {
		MutableList.append(placed, {lane, span})
		MutableList.append(intervals, {end: span.offsetMs + span.durationMs, lane, start: span.offsetMs})
		return lane
	}
	if (root !== undefined) add(root, 0)
	Array.forEach(jobs, span => {
		const lane = add(span, laneCount())
		Option.match(Record.get(reservations, span.spanId), {
			onNone: () => undefined,
			onSome: reserve =>
				MutableList.append(intervals, {
					end: span.offsetMs + span.durationMs + reserve,
					lane,
					start: span.offsetMs + span.durationMs
				})
		})
	})
	Array.forEach(rest, span => {
		const end = span.offsetMs + span.durationMs
		const lanes = laneCount()
		Option.match(
			Array.findFirst(Array.range(0, lanes - 1), lane =>
				Array.every(
					Array.filter(MutableList.toArray(intervals), interval => interval.lane === lane),
					interval => {
						if (span.durationMs === 0) return !(interval.start <= span.offsetMs && span.offsetMs <= interval.end)
						return !(span.offsetMs < interval.end && interval.start < end)
					}
				)
			),
			{onNone: () => add(span, lanes), onSome: lane => add(span, lane)}
		)
	})
	return MutableList.toArray(placed)
}
