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

it('stacks every recorded app heaviest first, stopped ones too, then the small ones together and the rest of the machine', () => {
	const apps = [
		{cpu: 10, id: 'service:user:t3code.service', memory: 3 * GIB},
		{cpu: 5, id: 'service:system:postgres.service', memory: 2 * GIB},
		{cpu: 0, id: 'service:system:tiny.service', memory: 1024},
		{cpu: 0, id: 'service:system:other.service', memory: 1024},
		{cpu: 30, id: 'service:user:stopped.service', memory: GIB}
	]
	const result = bands(machine([sample(60_000, apps), sample(120_000, Array.take(apps, 4))]))
	assert.deepStrictEqual(
		Array.map(result, band => band.id),
		[
			'service:user:t3code.service',
			'service:system:postgres.service',
			'service:user:stopped.service',
			'other',
			'system'
		]
	)
	assert.closeTo(result[0]?.memory[0] ?? 0, 30, 0.01)
	assert.isTrue((result[0]?.opacity ?? 0) > (result[1]?.opacity ?? 0))
	// The app that stopped keeps its band where it ran, and the machine's other use is what no app holds.
	assert.deepStrictEqual(result[2]?.cpu, [30, 0])
	assert.closeTo(result[4]?.memory[0] ?? 0, 0, 0.01)
	assert.closeTo(result[4]?.memory[1] ?? 0, 10, 0.01)
	assert.strictEqual(result[4]?.cpu[0], 5)
})

it('breaks the time axis where the recording misses slots or a sample lacks the reading', () => {
	const hour = 3_600_000
	const result = runs(
		machine([
			sample(hour - 480_000, []),
			sample(hour - 420_000, []),
			// One slot a sample's timing skipped keeps the line; three missed slots break it.
			sample(hour - 300_000, []),
			sample(hour - 120_000, []),
			{...sample(hour - 60_000, []), cpu: undefined},
			sample(hour, [])
		]),
		60,
		entry => entry.cpu !== undefined
	)
	assert.deepStrictEqual(
		Array.map(result, run => Array.map(run, point => point.index)),
		[[0, 1, 2], [3], [5]]
	)
	assert.isTrue(Array.every(Array.flatten(result), point => point.x >= 0 && point.x <= 100))
})
