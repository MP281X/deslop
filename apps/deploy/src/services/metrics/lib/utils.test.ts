import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {chartWindow, counters, history, sample} from '#services/metrics/lib/utils.ts'

const MEMORY = 'MemTotal: 1024 kB\nMemAvailable: 256 kB\nSwapTotal: 512 kB\nSwapFree: 128 kB'
const STORAGE = 'Mounted on 1B-blocks Used\n/ 1000000 750000'

it('measures deltas, excludes virtual interfaces and partitions, and leaves reset/gap rates absent', () => {
	const first = counters(
		'cpu 100 0 100 600 0 0 0 0 999 999',
		'eth0: 30000 0 0 0 0 0 0 0 60000\nlo: 999999 0 0 0 0 0 0 0 999999\ntailscale0: 999999 0 0 0 0 0 0 0 999999',
		'8 0 sda 0 0 100 0 0 0 200\n8 1 sda1 0 0 100 0 0 0 200',
		'100 0',
		30_000
	)
	assert.strictEqual(first.cpuTotal, 800)
	assert.strictEqual(first.diskRead, 51_200)
	assert.strictEqual(first.networkReceive, 30_000)
	const current = {
		...first,
		cpuIdle: 700,
		cpuTotal: 1000,
		diskRead: 81_200,
		diskWrite: 162_400,
		networkReceive: 60_000,
		networkSend: 120_000,
		time: 60_000,
		uptime: 130
	}
	const value = sample(current, MEMORY, STORAGE, first)
	assert.strictEqual(value.cpu, 50)
	assert.strictEqual(value.networkReceive, 1000)
	assert.strictEqual(value.networkSend, 2000)
	assert.strictEqual(value.diskRead, 1000)
	assert.strictEqual(value.memoryUsed, 768 * 1024)
	assert.strictEqual(value.swapUsed, 384 * 1024)
	assert.deepStrictEqual(value.disks, [{mount: '/', total: 1_000_000, used: 750_000}])
	assert.isUndefined(sample(current, MEMORY, STORAGE).cpu)
	assert.isUndefined(sample({...current, uptime: 1}, MEMORY, STORAGE, first).cpu)
	assert.isUndefined(sample({...current, networkReceive: 1}, MEMORY, STORAGE, first).networkReceive)
	assert.isUndefined(sample({...current, time: 150_001}, MEMORY, STORAGE, first).networkReceive)
})

it('bounds history by the chosen time window and response size without synthesizing measurements', () => {
	const value = sample(counters('cpu 100 0 100 600 0 0 0 0', '', '', '100 0', 0), MEMORY, STORAGE)
	const samples = Array.makeBy(20_161, index => ({...value, time: index * 30_000}))
	const now = 168 * 3_600_000
	const selected = history(samples, 1, now)
	assert.lengthOf(selected, 121)
	assert.isAtMost(history(samples, 168, now).length, 481)
	assert.strictEqual(Option.getOrThrow(Array.last(selected)).time, now)
	assert.strictEqual(history(samples, 168, now)[0]?.time, 0)
	assert.isEmpty(history(samples, 1, now + 2 * 3_600_000))
})

it('measures individual logical cores, memory detail, load and uptime without bridging resets', () => {
	const first = counters('cpu 100 0 100 600 0 0 0 0\ncpu0 100 0 100 600 0 0 0 0', '', '', '100 0', 0)
	const current = counters(
		'cpu 150 0 150 700 0 0 0 0\ncpu0 150 0 150 700 0 0 0 0\ncpu1 10 0 10 20 0 0 0 0',
		'',
		'',
		'130 0',
		30_000
	)
	const value = sample(
		current,
		`${MEMORY}\nCached: 32 kB\nSReclaimable: 16 kB\nBuffers: 8 kB`,
		STORAGE,
		first,
		'1.5 2.5 3.5 1/20 123'
	)
	assert.deepStrictEqual(value.cores, [
		{id: 'cpu0', usage: 50},
		{id: 'cpu1', usage: undefined}
	])
	assert.strictEqual(value.memoryCached, 48 * 1024)
	assert.strictEqual(value.memoryAvailable, 256 * 1024)
	assert.strictEqual(value.memoryBuffers, 8 * 1024)
	assert.deepStrictEqual(value.load, [1.5, 2.5, 3.5])
	assert.strictEqual(value.uptime, 130)
	assert.isUndefined(sample({...current, uptime: 1}, MEMORY, STORAGE, first).cores[0]?.usage)
	assert.isUndefined(sample({...current, time: 100_000}, MEMORY, STORAGE, first).cores[0]?.usage)
	assert.isUndefined(
		sample({...current, cores: [{id: 'cpu0', idle: 1, total: 1000}]}, MEMORY, STORAGE, first).cores[0]?.usage
	)
})

it('uses actual recording coverage for a new agent without hiding a full selected window or fabricating timestamps', () => {
	const value = sample(counters('cpu 100 0 100 600 0 0 0 0', '', '', '100 0', 0), MEMORY, STORAGE)
	const fresh = Array.makeBy(21, index => ({...value, time: index * 30_000}))
	assert.deepStrictEqual(history(fresh, 168, 600_000), fresh)
	assert.deepStrictEqual(chartWindow(history(fresh, 168, 600_000), 168, 600_000), {end: 600_000, start: 0})
	assert.deepStrictEqual(chartWindow([{...value, time: 3_000_000}], 1, 3_600_000), {end: 3_600_000, start: 3_000_000})
	assert.deepStrictEqual(chartWindow([{...value, time: 0}], 1, 7_200_000), {end: 7_200_000, start: 3_600_000})
	assert.deepStrictEqual(chartWindow([], 1, 3_600_000), {end: 3_600_000, start: 3_480_000})
})
