import {assert, it} from '@effect/vitest'

import {Array, Duration} from 'effect'

import {hitAreasOf, lanesOf} from './shared.ts'

import {SpanId} from '#telemetry/contract.ts'

const SPANS = [
	{depth: 0, durationMs: Duration.millis(1000), offsetMs: Duration.zero, spanId: SpanId.make('0000000000000001')},
	{depth: 1, durationMs: Duration.millis(400), offsetMs: Duration.zero, spanId: SpanId.make('0000000000000002')},
	{depth: 1, durationMs: Duration.millis(500), offsetMs: Duration.millis(500), spanId: SpanId.make('0000000000000003')},
	{depth: 2, durationMs: Duration.millis(100), offsetMs: Duration.zero, spanId: SpanId.make('0000000000000004')},
	{depth: 2, durationMs: Duration.millis(100), offsetMs: Duration.millis(500), spanId: SpanId.make('0000000000000005')}
] as const

it('gives jobs distinct lanes and packs their steps into free time', () => {
	assert.deepStrictEqual(
		Array.map(lanesOf(SPANS), entry => [entry.span.spanId, entry.lane]),
		[
			['0000000000000001', 0],
			['0000000000000002', 1],
			['0000000000000003', 2],
			['0000000000000004', 2],
			['0000000000000005', 1]
		]
	)
})

it('reserves space for the label after a job', () => {
	assert.deepStrictEqual(
		Array.map(
			lanesOf([SPANS[0], SPANS[1], {...SPANS[4], offsetMs: Duration.millis(450)}], {
				[SpanId.make('0000000000000002')]: Duration.millis(300)
			}),
			entry => entry.lane
		),
		[0, 1, 2]
	)
})

it('widens a small mark into free time, stopping halfway to a neighbour, between overlapping centres and at the graph edges', () => {
	assert.deepStrictEqual(
		hitAreasOf(
			[
				{lane: 0, left: 0, right: 100},
				{lane: 1, left: 10, right: 12},
				{lane: 1, left: 16, right: 18},
				{lane: 1, left: 98, right: 100},
				{lane: 2, left: 0, right: 2},
				{lane: 2, left: 1, right: 3}
			],
			100,
			12
		),
		[
			{left: 0, width: 100},
			{left: 2, width: 12},
			{left: 14, width: 12},
			{left: 88, width: 12},
			{left: 0, width: 1.5},
			{left: 1.5, width: 12}
		]
	)
})
