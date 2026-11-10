import {assert, it} from '@effect/vitest'

import {Array, HashMap, Option, Order, String} from 'effect'

import {overviewOf, retentionOf, tracedOf} from '#services/telemetry/lib/utils.ts'
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

function appOf(frame: ReturnType<typeof overviewOf>, name: string) {
	return Option.getOrThrow(Array.findFirst(frame.apps, current => current.name === name))
}

it('counts each app’s operations only inside the page’s time frame and keeps every app tab', () => {
	const hour = overviewOf(tracedOf(entries, NOW), NOW, '1h')
	assert.deepStrictEqual(
		Array.map(appOf(hour, 'stash').operations, operation => [operation.name, operation.count, operation.p50Ms]),
		[['share', 1, 10]]
	)
	assert.lengthOf(hour.apps, 2)
	assert.lengthOf(appOf(hour, 'gateway').operations, 0)

	const day = overviewOf(tracedOf(entries, NOW), NOW, '24h')
	assert.deepStrictEqual(
		Array.map(appOf(day, 'stash').operations, operation => [operation.name, operation.count, operation.p50Ms]),
		[['share', 3, 100]]
	)
	assert.deepStrictEqual(
		Array.map(appOf(day, 'gateway').operations, operation => [operation.name, operation.count]),
		[['share', 1]]
	)
})

it('expires every entry of a trace when one entry outlives retention', () => {
	const trace = String.repeat(32)('a')
	const root = {
		...span(trace, '@deslop/stash-server', NOW - 71 * HOUR, 10),
		id: 'root',
		receivedAt: NOW,
		spanId: '1111111111111111'
	}
	const child = {
		...span(trace, '@deslop/stash-ios', NOW - 11 * HOUR, 10),
		id: 'child',
		receivedAt: NOW + 60 * HOUR,
		spanId: '2222222222222222'
	}
	const retention = retentionOf(
		HashMap.fromIterable([
			['root', root],
			['child', child]
		]),
		{},
		NOW + 73 * HOUR,
		3 * 24 * HOUR
	)
	assert.deepStrictEqual(
		Array.sort(
			Array.map(retention.expired, entry => entry.id),
			Order.String
		),
		['child', 'root']
	)
	assert.isTrue(HashMap.isEmpty(retention.next))
})
