import {assert, it} from '@effect/vitest'

import {Array, HashMap, Option, Order, Record, String} from 'effect'

import {overviewOf, retentionOf, serviceStatuses, tracedTrace} from '#services/telemetry/lib/utils.ts'
import {Entry} from '#services/telemetry/schema.ts'

const NOW = 1_781_870_000_000
const HOUR = 3_600_000

// Every trace in one snapshot, grouped once for the frame assertions.
function tracedOf(entries: readonly Entry[], now: number) {
	return Array.getSomes(
		Array.map(
			Record.values(
				Array.groupBy(
					Array.filter(entries, entry => entry.traceId !== ''),
					entry => entry.traceId
				)
			),
			records => tracedTrace(records, now)
		)
	)
}

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

function event(id: string, service: string, run: number, time: number, version = '') {
	return Entry.make({
		durationMs: 0,
		id,
		name: 'event',
		payload: {},
		resource: {
			attributes: [
				{key: 'service.name', value: {stringValue: service}},
				{key: 'scope.runtime', value: {stringValue: 'server'}},
				{key: 'scope.run.started_unix_nano', value: {stringValue: `${run}`}},
				...Array.map(Array.filter([version], String.isNonEmpty), value => ({
					key: 'service.version',
					value: {stringValue: value}
				}))
			]
		},
		service,
		signal: 'log',
		spanId: '',
		status: 0,
		time: `${BigInt(time) * 1_000_000n}`,
		traceId: ''
	})
}

it('counts each service’s latest run once and names it by that run’s first entry', () => {
	const older = NOW - 30_000
	const first = NOW - 20_000
	const last = NOW - 10_000
	assert.deepStrictEqual(
		serviceStatuses([
			event('a1', '@deslop/a-server', 1000, older, '0.1.1'),
			event('a2', '@deslop/a-server', 2000, first, '0.1.2'),
			event('a3', '@deslop/a-server', 2000, last),
			event('b1', '@deslop/b-server', 3000, NOW)
		]),
		[
			{
				entries: 2,
				lastEventAt: `${BigInt(last) * 1_000_000n}`,
				name: '@deslop/a-server',
				runStartedAt: '2000',
				runtime: 'server',
				version: '0.1.2'
			},
			{
				entries: 1,
				lastEventAt: `${BigInt(NOW) * 1_000_000n}`,
				name: '@deslop/b-server',
				runStartedAt: '3000',
				runtime: 'server',
				version: ''
			}
		]
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
