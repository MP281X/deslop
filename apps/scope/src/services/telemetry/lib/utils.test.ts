import {assert, it} from '@effect/vitest'

import {Array, Duration, Option, String} from 'effect'

import {overviewOf} from '#services/telemetry/lib/utils.ts'
import type {Traced} from '#services/telemetry/lib/utils.ts'
import {TraceId} from '#services/telemetry/schema.ts'

const NOW = 1_781_870_000_000
const HOUR = 3_600_000

function traced(id: string, app: string, start: number, durationMs: number) {
	return {
		app,
		failed: false,
		name: 'share',
		runtime: 'server',
		trace: {duration: Duration.millis(durationMs), id: TraceId.make(id), start}
	} satisfies Traced
}

const traces = [
	traced(String.repeat(32)('a'), 'stash', NOW - 5 * 60_000, 10),
	traced(String.repeat(32)('b'), 'stash', NOW - 2 * HOUR, 100),
	traced(String.repeat(32)('c'), 'stash', NOW - 3 * HOUR, 1000),
	traced(String.repeat(32)('d'), 'gateway', NOW - 2 * HOUR, 20)
]

function appOf(frame: ReturnType<typeof overviewOf>, name: string) {
	return Option.getOrThrow(Array.findFirst(frame.apps, current => current.name === name))
}

it('counts each app’s operations only inside the page’s time frame and keeps every app tab', () => {
	const hour = overviewOf(traces, NOW, '1h')
	assert.deepStrictEqual(
		Array.map(appOf(hour, 'stash').operations, operation => [operation.name, operation.count, operation.p50Ms]),
		[['share', 1, 10]]
	)
	assert.lengthOf(hour.apps, 2)
	assert.lengthOf(appOf(hour, 'gateway').operations, 0)

	const day = overviewOf(traces, NOW, '24h')
	assert.deepStrictEqual(
		Array.map(appOf(day, 'stash').operations, operation => [operation.name, operation.count, operation.p50Ms]),
		[['share', 3, 100]]
	)
	assert.deepStrictEqual(
		Array.map(appOf(day, 'gateway').operations, operation => [operation.name, operation.count]),
		[['share', 1]]
	)
})

it('orders an app’s operations failing first, then most recently seen', () => {
	const day = overviewOf(
		[
			{...traced(String.repeat(32)('a'), 'stash', NOW - 3 * HOUR, 10), name: 'old'},
			{...traced(String.repeat(32)('b'), 'stash', NOW - 2 * HOUR, 10), failed: true, name: 'broken'},
			{...traced(String.repeat(32)('c'), 'stash', NOW - 4 * HOUR, 10), name: 'new'},
			{...traced(String.repeat(32)('d'), 'stash', NOW - 5 * 60_000, 10), name: 'new'}
		],
		NOW,
		'24h'
	)
	assert.deepStrictEqual(
		Array.map(appOf(day, 'stash').operations, operation => operation.name),
		['broken', 'new', 'old']
	)
})

function traceId(index: number) {
	return String.padStart(32, '0')(index.toString(16))
}

it('keeps the newest failures among the slowest traces of an operation with 145,000 of them', () => {
	const busy = Array.makeBy(145_000, index => ({
		...traced(traceId(index), 'stash', NOW - index * 1000, index % 1000),
		failed: index % 100 === 0
	}))
	const operation = Option.getOrThrow(Array.head(appOf(overviewOf(busy, NOW, '3d'), 'stash').operations))
	assert.deepStrictEqual([operation.count, operation.failures], [145_000, 1450])
	assert.deepStrictEqual(
		Array.map(operation.traces, trace => trace.id),
		Array.map(
			[...Array.makeBy(10, index => index * 1000 + 999), ...Array.makeBy(10, index => 900 - index * 100)],
			traceId
		)
	)
})
