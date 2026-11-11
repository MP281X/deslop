import {Array, MutableList, Option, Order, Record} from 'effect'

export type FlameSpan = {depth: number; durationMs: number; offsetMs: number; spanId: string}

type Interval = {end: number; start: number}
type Lane = {intervals: readonly Interval[]; lastEnd: number}

function byStart<T extends FlameSpan>() {
	return Order.combine(
		Order.mapInput(Order.Number, (span: T) => span.offsetMs),
		Order.mapInput(Order.flip(Order.Number), (span: T) => span.durationMs)
	)
}

// A zero-length span occupies its instant, so it collides with an interval ending there.
function collides(span: FlameSpan, interval: Interval) {
	if (span.durationMs === 0) return interval.start <= span.offsetMs && span.offsetMs <= interval.end
	return span.offsetMs < interval.end && interval.start < span.offsetMs + span.durationMs
}

// A lane's root or job intervals and the end of its latest deeper span; those arrive in start order, so every earlier one has ended by then.
function laneIsFree(lane: Lane, span: FlameSpan) {
	const clearOfSeeds = Array.every(lane.intervals, interval => !collides(span, interval))
	if (span.durationMs === 0) return clearOfSeeds && lane.lastEnd < span.offsetMs
	return clearOfSeeds && lane.lastEnd <= span.offsetMs
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
	const lanes = MutableList.make<Lane>()
	function place(span: T, lane: number) {
		MutableList.append(placed, {lane, span})
	}
	function addLane(span: T) {
		const interval = {end: span.offsetMs + span.durationMs, start: span.offsetMs}
		const intervals = Option.match(Record.get(reservations, span.spanId), {
			onNone: () => Array.make(interval),
			onSome: reserve => Array.make(interval, {end: interval.end + reserve, start: interval.end})
		})
		MutableList.append(lanes, {intervals, lastEnd: -Infinity})
		place(span, lanes.length - 1)
	}
	if (root !== undefined) addLane(root)
	Array.forEach(jobs, addLane)
	Array.forEach(rest, span => {
		const existing = MutableList.toArray(lanes)
		const end = span.offsetMs + span.durationMs
		Option.match(
			Array.findFirstIndex(existing, lane => laneIsFree(lane, span)),
			{
				onNone: () => {
					MutableList.append(lanes, {intervals: [], lastEnd: end})
					place(span, lanes.length - 1)
				},
				onSome: lane => {
					Array.getUnsafe(existing, lane).lastEnd = end
					place(span, lane)
				}
			}
		)
	})
	return MutableList.toArray(placed)
}
