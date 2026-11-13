import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Option, String} from 'effect'

import {overviewOf} from '#services/telemetry/lib/utils.ts'
import type {Traced} from '#services/telemetry/lib/utils.ts'
import {AppName, ServiceName, TraceId} from '#services/telemetry/schema.ts'

const NOW = 1_781_870_000_000
const HOUR = 3_600_000

function traced(id: string, app: string, start: number, durationMs: number) {
	return {
		app: AppName.make(app),
		failed: false,
		name: 'share',
		runtime: 'server',
		trace: {
			duration: Duration.millis(durationMs),
			failure: Option.none(),
			id: TraceId.make(id),
			label: Option.none(),
			start: DateTime.makeUnsafe(start)
		}
	} satisfies Traced
}

const traces = [
	traced(String.repeat(32)('a'), 'stash', NOW - 5 * 60_000, 10),
	traced(String.repeat(32)('b'), 'stash', NOW - 2 * HOUR, 100),
	traced(String.repeat(32)('c'), 'stash', NOW - 3 * HOUR, 1000),
	traced(String.repeat(32)('d'), 'gateway', NOW - 2 * HOUR, 20)
]

const retained = [
	{ci: false, count: 3, failures: 0, service: ServiceName.make('stash')},
	{ci: false, count: 1, failures: 0, service: ServiceName.make('gateway')}
]

function appOf(frame: ReturnType<typeof overviewOf>, name: string) {
	return Option.getOrThrow(Array.findFirst(frame.apps, current => current.name === name))
}

it('counts queried operations and keeps every retained app tab', () => {
	const hour = overviewOf(Array.take(traces, 1), retained)
	assert.deepStrictEqual(
		Array.map(appOf(hour, 'stash').operations, operation => [
			operation.name,
			operation.count,
			Duration.toMillis(operation.p50Ms)
		]),
		[['share', 1, 10]]
	)
	assert.lengthOf(hour.apps, 2)
	assert.lengthOf(appOf(hour, 'gateway').operations, 0)

	const day = overviewOf(traces, retained)
	assert.deepStrictEqual(
		Array.map(appOf(day, 'stash').operations, operation => [
			operation.name,
			operation.count,
			Duration.toMillis(operation.p50Ms)
		]),
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
		[{ci: false, count: 4, failures: 1, service: ServiceName.make('stash')}]
	)
	assert.deepStrictEqual(
		Array.map(appOf(day, 'stash').operations, operation => operation.name),
		['broken', 'new', 'old']
	)
})
