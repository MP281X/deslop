import {assert, it} from '@effect/vitest'

import {Array, DateTime, Duration, Option, Schema} from 'effect'

import {Process} from './contract.ts'
import type {AppId} from './contract.ts'
import {commandLabel, processReadings} from './processes.ts'

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
			start: Duration.millis(100),
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
			{...CURRENT, records: Array.map(CURRENT.records, record => ({...record, start: Duration.millis(101)}))},
			baseline
		).readings[0]?.process.cpu,
		Option.none()
	)
})

it('labels a wrapped command by what it runs, past the wrapper’s flag values and operands', () => {
	assert.deepStrictEqual(commandLabel(['timeout', '5', 'node', 'server.js'], Option.none()).name, 'server.js')
	assert.deepStrictEqual(commandLabel(['sudo', '-u', 'dev', 'node', 'server.js'], Option.none()).name, 'server.js')
	assert.deepStrictEqual(commandLabel(['env', 'PORT=1', 'nice', '-n', '5', 'vite-plus', 'dev'], Option.none()), {
		detail: 'dev',
		name: 'vp'
	})
})

it('masks a credential inside a shell’s command string, quoted or not, as it does in a command’s own arguments', () => {
	const scripts = [
		'curl --header "Authorization: Bearer fixture-credential-marker" https://example.invalid; :',
		"curl -H 'Authorization: Bearer fixture-credential-marker' https://example.invalid",
		'curl --header Authorization: Bearer fixture-credential-marker https://example.invalid',
		'curl --token "fixture credential marker" https://example.invalid',
		'curl --password=fixture-credential-marker https://example.invalid',
		'curl --api-key fixture-credential-marker https://example.invalid',
		'curl Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4YWJj https://example.invalid'
	]
	assert.deepStrictEqual(
		Array.map(scripts, script => commandLabel(['/bin/bash', '-c', script], Option.none())),
		Array.map(scripts, () => ({detail: 'example.invalid', name: 'curl'}))
	)
})
