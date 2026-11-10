import {assert, it} from '@effect/vitest'

import {Array, Function, Option} from 'effect'

import {appHue, bands, focusedBand, runs} from '#routes/(home)/-usage.ts'
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

it('tints a Deslop app with its icon hue and leaves a service without one grey', () => {
	assert.deepStrictEqual(appHue('deploy preview'), Option.some('var(--blue)'))
	assert.deepStrictEqual(appHue('stash'), Option.some('var(--amber)'))
	assert.deepStrictEqual(appHue('preview gateway'), Option.some('var(--pink)'))
	assert.isTrue(Option.isNone(appHue('t3code')))
	assert.isTrue(Option.isNone(appHue('postgres')))
})

it('focuses the selected app, the small apps’ block when it shares that, and nothing when the range never recorded it', () => {
	const history = machine([
		sample(60_000, [
			{cpu: 10, id: 'service:user:t3code.service', memory: 3 * GIB},
			{cpu: 0, id: 'service:system:tiny.service', memory: 1024}
		])
	])
	assert.deepStrictEqual(
		focusedBand(history, 'service:user:t3code.service'),
		Option.some('service:user:t3code.service')
	)
	assert.deepStrictEqual(focusedBand(history, 'service:system:tiny.service'), Option.some('other'))
	assert.deepStrictEqual(focusedBand(history, 'service:user:gone.service'), Option.none())
})

it('breaks the time axis where the recording misses a slot or a sample lacks the reading', () => {
	const hour = 3_600_000
	const result = runs(
		machine([
			sample(hour - 300_000, []),
			sample(hour - 240_000, []),
			// Two minutes apart is a missed minute on the hour's chart.
			sample(hour - 120_000, []),
			{...sample(hour - 60_000, []), cpu: undefined},
			sample(hour, [])
		]),
		60,
		entry => entry.cpu !== undefined
	)
	assert.deepStrictEqual(
		Array.map(result, run => Array.map(run, point => point.index)),
		[[0, 1], [2], [4]]
	)
	assert.isTrue(Array.every(Array.flatten(result), point => point.x >= 0 && point.x <= 100))
	// A second sample that lands late by its sampling skips no slot on the minute's chart.
	assert.lengthOf(runs(machine([sample(57_000, []), sample(58_000, []), sample(59_900, [])]), 1, Function.constTrue), 1)
})
