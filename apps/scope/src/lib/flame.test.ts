import {assert, it} from '@effect/vitest'

import {Array, Duration} from 'effect'

import {lanesOf} from '#lib/flame.ts'
import {SpanId} from '#services/telemetry/schema.ts'

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
