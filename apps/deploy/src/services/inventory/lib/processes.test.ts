import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, HashMap, Option, Schema} from 'effect'

import {launchdProcesses, processReadings} from './processes.ts'

import type {AppId} from '#services/inventory/schema.ts'
import {Process, ProcessId, UnitId} from '#services/inventory/schema.ts'

const PREVIOUS = {
	records: [
		{
			owner: Option.none<AppId>(),
			process: Schema.decodeSync(Process)({
				label: {detail: '', name: 'node'},
				memory: 1024,
				name: 'node',
				parent: 1,
				pid: 42
			}),
			start: DateTime.makeUnsafe(100),
			ticks: Duration.millis(10)
		}
	],
	time: DateTime.makeUnsafe(0),
	total: Duration.millis(800)
}

const CURRENT = {
	...PREVIOUS,
	records: Array.map(PREVIOUS.records, record => ({...record, ticks: Duration.millis(60)})),
	time: DateTime.makeUnsafe(10_000),
	total: Duration.millis(1000)
}

it('measures CPU deltas only across readings of the same live process', () => {
	const baseline = Option.some(processReadings(PREVIOUS, Option.none()))
	assert.deepStrictEqual(processReadings(CURRENT, baseline).readings[0]?.process.cpu, Option.some(25))
	assert.deepStrictEqual(processReadings(CURRENT, Option.none()).readings[0]?.process.cpu, Option.none())
	assert.deepStrictEqual(
		processReadings({...CURRENT, time: DateTime.makeUnsafe(91_000)}, baseline).readings[0]?.process.cpu,
		Option.none()
	)
	assert.deepStrictEqual(
		processReadings({...CURRENT, total: Duration.millis(100)}, baseline).readings[0]?.process.cpu,
		Option.none()
	)
	assert.deepStrictEqual(
		processReadings(
			{...CURRENT, records: Array.map(CURRENT.records, record => ({...record, start: DateTime.makeUnsafe(101)}))},
			baseline
		).readings[0]?.process.cpu,
		Option.none()
	)
})

it('labels a process without the credential its arguments carry', () => {
	const [record] = launchdProcesses(
		'12 1 1024 0:01.01 Wed Nov 18 09:00:00 2026 /usr/bin/curl --header Authorization: Bearer fixture-value-only https://example.invalid',
		HashMap.make([ProcessId.make(12), UnitId.make('fixture')]),
		HashMap.empty()
	)
	assert.deepStrictEqual(
		Option.map(Option.fromUndefinedOr(record), found => found.process.label),
		Option.some({detail: 'example.invalid', name: 'curl'})
	)
})
