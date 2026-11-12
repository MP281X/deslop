import {assert, it} from '@effect/vitest'

import {Array, Duration, Option, String} from 'effect'

import {overviewOf} from '#services/telemetry/lib/utils.ts'
import type {Traced} from '#services/telemetry/lib/utils.ts'

const NOW = 1_781_870_000_000
const HOUR = 3_600_000

function traced(id: string, app: string, start: number, durationMs: number) {
	return {
		app,
		name: 'share',
		runtime: 'server',
		trace: {duration: Duration.millis(durationMs), id, start}
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
