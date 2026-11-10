import {assert, it} from '@effect/vitest'

import {Array, Option, String} from 'effect'

import {overview} from '#services/telemetry/lib/utils.ts'
import {Entry} from '#services/telemetry/schema.ts'

const NOW = 1_781_870_000_000
const HOUR = 3_600_000

function span(id: string, service: string, start: number, durationMs: number) {
	return Entry.make({
		durationMs,
		id,
		name: 'share',
		payload: {},
		resource: {
			attributes: [
				{key: 'service.name', value: {stringValue: service}},
				{key: 'scope.runtime', value: {stringValue: 'server'}}
			]
		},
		service,
		signal: 'trace',
		spanId: String.slice(0, 16)(id),
		status: 0,
		time: `${BigInt(start) * 1_000_000n}`,
		traceId: id
	})
}

const entries = [
	span(String.repeat(32)('a'), '@deslop/stash-server', NOW - 5 * 60_000, 10),
	span(String.repeat(32)('b'), '@deslop/stash-server', NOW - 2 * HOUR, 100),
	span(String.repeat(32)('c'), '@deslop/stash-server', NOW - 3 * HOUR, 1000),
	span(String.repeat(32)('d'), '@deslop/gateway-server', NOW - 2 * HOUR, 20)
]

function appOf(frame: ReturnType<typeof overview>, name: string) {
	return Option.getOrThrow(Array.findFirst(frame.apps, current => current.name === name))
}

it('counts each app’s operations only inside the page’s time frame and keeps every app tab', () => {
	const hour = overview(entries, NOW, '1h')
	assert.deepStrictEqual(
		Array.map(appOf(hour, 'stash').operations, operation => [operation.name, operation.count, operation.p50Ms]),
		[['share', 1, 10]]
	)
	assert.lengthOf(hour.apps, 2)
	assert.lengthOf(appOf(hour, 'gateway').operations, 0)

	const day = overview(entries, NOW, '24h')
	assert.deepStrictEqual(
		Array.map(appOf(day, 'stash').operations, operation => [operation.name, operation.count, operation.p50Ms]),
		[['share', 3, 100]]
	)
	assert.deepStrictEqual(
		Array.map(appOf(day, 'gateway').operations, operation => [operation.name, operation.count]),
		[['share', 1]]
	)
})
