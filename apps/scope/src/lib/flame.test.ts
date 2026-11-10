import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {lanesOf} from '#lib/flame.ts'

type Span = {depth: number; durationMs: number; offsetMs: number; spanId: string}

function span(spanId: string, depth: number, offsetMs: number, durationMs: number) {
	return {depth, durationMs, offsetMs, spanId}
}

function laneOf(placed: readonly {lane: number; span: Span}[], spanId: string) {
	return Option.getOrUndefined(Array.findFirst(placed, entry => entry.span.spanId === spanId))?.lane
}

function assertLanesDisjoint(placed: readonly {lane: number; span: Span}[], lanes: number) {
	for (const lane of Array.range(0, lanes - 1)) {
		const laneSpans = Array.map(
			Array.filter(placed, entry => entry.lane === lane),
			entry => entry.span
		)
		Array.forEach(laneSpans, (left, index) =>
			Array.forEach(Array.drop(laneSpans, index + 1), right =>
				assert.isFalse(
					left.offsetMs < right.offsetMs + right.durationMs && right.offsetMs < left.offsetMs + left.durationMs
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
