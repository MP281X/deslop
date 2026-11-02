import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {bands, runs} from '#routes/(home)/-usage.ts'
import type {MachineHistory, Sample} from '#services/metrics/schema.ts'

const GIB = 1024 ** 3

function sample(time: number, apps: Sample['apps']) {
	return {
		apps,
		cpu: 50,
		disks: [],
		memoryTotal: 10 * GIB,
		memoryUsed: 6 * GIB,
		swapTotal: 0,
		swapUsed: 0,
		time
	} satisfies Sample
}

function machine(samples: Sample[]) {
	return {
		error: '',
		samples,
		stale: false,
		time: Option.getOrElse(
			Option.map(Array.last(samples), last => last.time),
			() => 0
		),
		worker: 'desktop'
	} satisfies MachineHistory
}

it('stacks known apps heaviest first, then the small ones together and the rest of the machine', () => {
	const apps = [
		{cpu: 10, id: 'service:user:t3code.service', memory: 3 * GIB},
		{cpu: 5, id: 'service:system:postgres.service', memory: 2 * GIB},
		{cpu: 0, id: 'service:system:tiny.service', memory: 1024},
		{cpu: 0, id: 'service:system:other.service', memory: 1024},
		{cpu: 30, id: 'service:system:unknown.service', memory: GIB}
	]
	const result = bands(machine([sample(60_000, apps), sample(120_000, apps)]), [
		'service:user:t3code.service',
		'service:system:postgres.service',
		'service:system:tiny.service',
		'service:system:other.service'
	])
	assert.deepStrictEqual(
		Array.map(result, band => band.id),
		['service:user:t3code.service', 'service:system:postgres.service', 'other', 'system']
	)
	assert.strictEqual(result[0]?.memory[0], 30)
	assert.isTrue((result[0]?.opacity ?? 0) > (result[1]?.opacity ?? 0))
	// The unknown owner and the rest of the used memory fall to the system band.
	assert.closeTo(result[3]?.memory[0] ?? 0, 10, 0.01)
	assert.strictEqual(result[3]?.cpu[0], 35)
})

it('breaks the time axis where a sample lacks the reading', () => {
	const hour = 3_600_000
	const result = runs(
		machine([
			sample(hour - 240_000, []),
			sample(hour - 180_000, []),
			{...sample(hour - 120_000, []), cpu: undefined},
			sample(hour - 60_000, []),
			sample(hour, [])
		]),
		1,
		entry => entry.cpu !== undefined
	)
	assert.deepStrictEqual(
		Array.map(result, run => Array.map(run, point => point.index)),
		[
			[0, 1],
			[3, 4]
		]
	)
	assert.isTrue(Array.every(Array.flatten(result), point => point.x >= 0 && point.x <= 100))
})
