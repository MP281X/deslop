import {assert, it} from '@effect/vitest'

import {Array, Function, HashSet, Option} from 'effect'

import {bandFill, bands, focusedBand, lowImpactIds, runs} from '#routes/(home)/-usage.ts'
import type {AppSample, MachineHistory, Sample} from '#services/metrics/schema.ts'

const GIB = 1024 ** 3

function sample(time: number, apps: readonly AppSample[]) {
	return {
		apps: Option.some(apps),
		cpu: Option.some(50),
		memoryTotal: 10 * GIB,
		memoryUsed: 6 * GIB,
		since: time,
		step: 1000,
		storageUsed: Option.none(),
		time
	} satisfies Sample
}

function machine(samples: Sample[]) {
	return {
		disks: [],
		error: '',
		load: [],
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

it('fills a Deslop app in its hue, another process in the page primary, and the aggregates and disk in their greys', () => {
	assert.deepStrictEqual(bandFill('app', 0.4, 't3code'), {color: 'var(--primary)', opacity: 0.4})
	assert.deepStrictEqual(bandFill('app', 0.4, 'scope'), {color: 'var(--cyan)', opacity: 0.9})
	assert.deepStrictEqual(bandFill('other', 0.35, 'Low impact'), {color: 'var(--input)', opacity: 1})
	assert.deepStrictEqual(bandFill('system', 0.18, 'System'), {color: 'var(--muted)', opacity: 1})
	assert.deepStrictEqual(bandFill('disk', 1, 'Disk'), {color: 'var(--muted-foreground)', opacity: 0.6})
})

it('puts an app in the low-impact set only when both peak memory and peak CPU stay under 5%', () => {
	const lowImpact = lowImpactIds(
		machine([
			sample(60_000, [
				{cpu: 4, id: 'service:user:near.service', memory: 1024},
				{cpu: 5, id: 'service:user:cpu.service', memory: 1024},
				{cpu: 0, id: 'service:user:memory.service', memory: 0.5 * GIB},
				{cpu: 0, id: 'service:user:tiny.service', memory: 1024}
			])
		])
	)
	assert.isTrue(HashSet.has(lowImpact, 'service:user:tiny.service'))
	assert.isTrue(HashSet.has(lowImpact, 'service:user:near.service'))
	assert.isFalse(HashSet.has(lowImpact, 'service:user:cpu.service'))
	assert.isFalse(HashSet.has(lowImpact, 'service:user:memory.service'))
})

it('focuses the selected app, the low-impact block when it shares that, and nothing when the range never recorded it', () => {
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
			{...sample(hour - 60_000, []), cpu: Option.none()},
			sample(hour, [])
		]),
		60,
		entry => Option.isSome(entry.cpu)
	)
	assert.deepStrictEqual(
		Array.map(result, run => Array.map(run, point => point.index)),
		[[0, 1], [2], [4]]
	)
	assert.isTrue(Array.every(Array.flatten(result), point => point.x >= 0 && point.x <= 100))
	// A second sample that lands late by its sampling skips no slot on the minute's chart.
	assert.lengthOf(runs(machine([sample(57_000, []), sample(58_000, []), sample(59_900, [])]), 1, Function.constTrue), 1)
})
