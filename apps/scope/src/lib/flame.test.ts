import {assert, it} from '@effect/vitest'

import {Array, Boolean, MutableList, Number, Option, Order, Record, pipe} from 'effect'

import {lanesOf} from '#lib/flame.ts'

type Span = {depth: number; durationMs: number; offsetMs: number; spanId: string}

function span(spanId: string, depth: number, offsetMs: number, durationMs: number) {
	return {depth, durationMs, offsetMs, spanId}
}

function byStart() {
	return pipe(
		Order.Number,
		Order.mapInput((item: Span) => item.offsetMs),
		pipelineSubject411 =>
			Order.combine(
				pipelineSubject411,
				Order.mapInput(Order.flip(Order.Number), (item: Span) => item.durationMs)
			)
	)
}

// The quadratic lane search the packer replaced, kept as the reference its lane choices must keep matching.
function referenceLanesOf(spans: readonly Span[], reservations: Record<string, number> = {}) {
	const root = Option.getOrUndefined(Array.findFirst(spans, item => item.depth === 0))
	const jobs = pipe(
		spans,
		Array.filter(item => item.depth === 1),
		pipelineSubject922 => Array.sort(pipelineSubject922, byStart())
	)
	const rest = pipe(
		spans,
		Array.filter(item => item.depth > 1 || (item.depth === 0 && item !== root)),
		pipelineSubject1012 => Array.sort(pipelineSubject1012, byStart())
	)
	const placed = MutableList.make<{lane: number; span: Span}>()
	const intervals = MutableList.make<{end: number; lane: number; start: number}>()
	function laneCount() {
		return Array.reduce(MutableList.toArray(placed), 0, (deepest, entry) => Number.max(deepest, entry.lane + 1))
	}
	function add(item: Span, lane: number) {
		MutableList.append(placed, {lane, span: item})
		MutableList.append(intervals, {end: item.offsetMs + item.durationMs, lane, start: item.offsetMs})
		return lane
	}
	if (root !== undefined) add(root, 0)
	Array.forEach(jobs, item => {
		const lane = add(item, laneCount())
		pipe(
			reservations,
			pipelineSubject1738 => Record.get(pipelineSubject1738, item.spanId),
			pipelineSubject1725 =>
				Option.match(pipelineSubject1725, {
					onNone: () => undefined,
					onSome: reserve =>
						MutableList.append(intervals, {
							end: item.offsetMs + item.durationMs + reserve,
							lane,
							start: item.offsetMs + item.durationMs
						})
				})
		)
	})
	Array.forEach(rest, item => {
		const end = item.offsetMs + item.durationMs
		const lanes = laneCount()
		pipe(
			Array.range(0, lanes - 1),
			Array.findFirst(lane =>
				pipe(
					MutableList.toArray(intervals),
					Array.filter(interval => interval.lane === lane),
					Array.every(interval => {
						if (item.durationMs === 0) return !(interval.start <= item.offsetMs && item.offsetMs <= interval.end)
						return !(item.offsetMs < interval.end && interval.start < end)
					})
				)
			),
			pipelineSubject2096 =>
				Option.match(pipelineSubject2096, {onNone: () => add(item, lanes), onSome: lane => add(item, lane)})
		)
	})
	return MutableList.toArray(placed)
}

// A stateless hash, so the same seed and index always give the same trace.
function noise(seed: number, index: number) {
	return ((Math.imul(seed * 31 + index, 2_654_435_761) ^ Math.imul(index + 1, 40_503)) >>> 0) / 4_294_967_296
}

function depthOf(index: number, size: number, seed: number) {
	if (index === 0) return 0
	if (index < Number.min(size, 20)) return 1
	return 2 + Math.floor(noise(seed, index) * 5)
}

function durationOf(index: number, seed: number) {
	if (index === 0) return 5000
	if (index % 6 === 0) return 0
	return Math.floor(noise(seed, index + 2) * 300)
}

function reservationOf(index: number) {
	if (index % 8 === 0) return 0
	return 30
}

// A trace-shaped input: a root, sequential jobs, then deeper spans inside the jobs' span, with repeated offsets and zero-length ticks.
function randomSpans(size: number, seed: number) {
	const [, spans] = Array.mapAccum(Array.range(0, size - 1), 0, (jobOffset, index) => {
		const depth = depthOf(index, size, seed)
		return [
			Boolean.match(depth === 1, {
				onFalse: () => jobOffset,
				onTrue: () => jobOffset + Math.floor(noise(seed, index + 3) * 40)
			}),
			span(
				`s${index}`,
				depth,
				Boolean.match(depth === 1, {
					onFalse: () => Math.floor(noise(seed, index + 1) * Number.max(jobOffset, 1)),
					onTrue: () => jobOffset
				}),
				durationOf(index, seed)
			)
		]
	})
	return spans
}

it('matches the quadratic lane search on random traces', () => {
	Array.forEach(Array.range(1, 40), seed =>
		Array.forEach([12, 40, 120] as const, size => {
			const spans = randomSpans(size, seed)
			const reservations = Record.fromEntries(
				Array.flatMap(spans, (item, index) => {
					if (item.depth !== 1 || index % 4 !== 0) return []
					return [[item.spanId, reservationOf(index)] as const]
				})
			)
			assert.deepStrictEqual(
				lanesOf(spans, reservations),
				referenceLanesOf(spans, reservations),
				`seed ${seed}, size ${size}`
			)
		})
	)
})

function laneOf(placed: readonly {lane: number; span: Span}[], spanId: string) {
	return Option.getOrUndefined(Array.findFirst(placed, entry => entry.span.spanId === spanId))?.lane
}

function assertLanesDisjoint(placed: readonly {lane: number; span: Span}[], lanes: number) {
	for (const lane of Array.range(0, lanes - 1)) {
		const laneSpans = pipe(
			placed,
			Array.filter(entry => entry.lane === lane),
			Array.map(entry => entry.span)
		)
		Array.forEach(laneSpans, (left, index) =>
			pipe(
				laneSpans,
				pipelineSubject5048 => Array.drop(pipelineSubject5048, index + 1),
				Array.forEach(right =>
					assert.isFalse(
						left.offsetMs < right.offsetMs + right.durationMs && right.offsetMs < left.offsetMs + left.durationMs
					)
				)
			)
		)
	}
}

it('gives the root and each job a lane of their own and packs a step into free time', () => {
	const spans = [
		span('root', 0, 0, 1000),
		span('test', 1, 0, 400),
		span('check', 1, 500, 500),
		span('set-up', 2, 0, 100),
		span('tests', 2, 100, 300),
		span('format', 2, 500, 100),
		span('complete', 2, 700, 0)
	]
	const placed = lanesOf(spans)
	assert.lengthOf(placed, spans.length)
	assert.strictEqual(laneOf(placed, 'root'), 0)
	assert.notStrictEqual(laneOf(placed, 'test'), laneOf(placed, 'check'))
	assert.strictEqual(laneOf(placed, 'set-up'), 2)
	assert.strictEqual(laneOf(placed, 'format'), 1)
	assert.strictEqual(laneOf(placed, 'complete'), 1)
	assertLanesDisjoint(placed, 3)
})

it('places a zero-length span and keeps every lane interval disjoint', () => {
	const spans = [span('root', 0, 0, 100), span('job', 1, 10, 20), span('complete', 2, 30, 0), span('tick', 2, 0, 0)]
	const placed = lanesOf(spans)
	assert.lengthOf(placed, spans.length)
	assertLanesDisjoint(placed, 2)
})

it('keeps a job’s label space free of a deeper span', () => {
	const placed = lanesOf([span('root', 0, 0, 1000), span('job', 1, 0, 100), span('step', 2, 150, 10)], {job: 300})
	assert.strictEqual(laneOf(placed, 'job'), 1)
	assert.strictEqual(laneOf(placed, 'step'), 2)
})

it('keeps two ticks at one instant in different lanes', () => {
	const placed = lanesOf([span('root', 0, 0, 1000), span('first', 2, 100, 0), span('second', 2, 100, 0)])
	assert.strictEqual(laneOf(placed, 'first'), 1)
	assert.strictEqual(laneOf(placed, 'second'), 2)
})
