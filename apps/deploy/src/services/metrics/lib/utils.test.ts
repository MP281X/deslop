import {assert, it} from '@effect/vitest'

import {Array, Option, Record} from 'effect'

import {
	SERIES,
	appCgroup,
	appShares,
	cgroupUsage,
	chartWindow,
	counters,
	history,
	resolution,
	rollup,
	sample
} from '#services/metrics/lib/utils.ts'
import type {Point} from '#services/metrics/lib/utils.ts'
import type {Sample} from '#services/metrics/schema.ts'

const MEMORY = 'MemTotal: 1024 kB\nMemAvailable: 256 kB'
const STORAGE = 'Mounted on 1B-blocks Used\n/ 1000000 750000'

const idle = sample(counters('cpu 100 0 100 600 0 0 0 0', '100 0', 0), MEMORY, STORAGE).point

// One series as a run of measurements leaves it in the table: each bucket's point, joined by its measurements in turn.
function series(points: readonly Point[], step: number) {
	return Array.flatMap(Record.values(Array.groupBy(points, point => `${Math.floor(point.time / step)}`)), bucket =>
		Array.reduce(bucket, Array.empty<Sample>(), (rows, point) =>
			Array.filter(rollup(point, rows), row => row.step === step)
		)
	)
}

it('measures CPU deltas and load, and leaves reset or gap readings absent', () => {
	const first = counters('cpu 100 0 100 600 0 0 0 0 999 999', '100 0', 30_000)
	assert.strictEqual(first.cpuTotal, 800)
	const current = {...first, cpuIdle: 700, cpuTotal: 1000, time: 60_000, uptime: 130}
	const value = sample(current, MEMORY, STORAGE, first, '1.5 2.5 3.5 1/20 123')
	assert.deepStrictEqual(value.point.cpu, Option.some(50))
	assert.strictEqual(value.point.memoryUsed, 768 * 1024)
	assert.deepStrictEqual(value.point.storageUsed, Option.some(750_000))
	assert.deepStrictEqual(value.disks, [{mount: '/', total: 1_000_000, used: 750_000}])
	assert.deepStrictEqual(value.load, [1.5, 2.5, 3.5])
	assert.isTrue(Option.isNone(sample(current, MEMORY, '').point.storageUsed))
	assert.isTrue(Option.isNone(sample(current, MEMORY, STORAGE).point.cpu))
	assert.isTrue(Option.isNone(sample({...current, uptime: 1}, MEMORY, STORAGE, first).point.cpu))
	assert.isTrue(Option.isNone(sample({...current, time: 150_001}, MEMORY, STORAGE, first).point.cpu))
})

it('reads each range from its own series in 60 slots without synthesizing measurements', () => {
	const week = Array.makeBy(20_161, index => ({...idle, time: index * 30_000}))
	const now = 168 * 3_600_000
	const selected = history(series(week, SERIES[60]), 60, now)
	assert.lengthOf(selected, 60)
	assert.lengthOf(history(series(week, SERIES[1440]), 1440, now), 60)
	assert.lengthOf(history(series(week, SERIES[10_080]), 10_080, now), 60)
	assert.strictEqual(Option.getOrThrow(Array.last(selected)).time, now)
	// The week's first hour ends inside the range, so its point counts from the hour's first measurement.
	assert.strictEqual(history(series(week, SERIES[10_080]), 10_080, now)[0]?.since, 0)
	assert.isEmpty(history(series(week, SERIES[60]), 60, now + 2 * 3_600_000))
	// Each series holds one point per bucket: a week of half-minutes is 169 hours.
	assert.lengthOf(series(week, SERIES[10_080]), 169)
})

it('leaves a missing reading unmeasured', () => {
	const selected = history(
		[
			{...idle, since: 0, step: 1000, time: 0},
			{...idle, cpu: Option.some(12.3456), since: 60_000, step: 1000, time: 60_000}
		],
		60,
		60_000
	)
	assert.deepStrictEqual(selected[0]?.storageUsed, Option.some(750_000))
	assert.isTrue(Option.isNone(selected[0]?.cpu ?? Option.some(0)))
	assert.deepStrictEqual(selected[1]?.cpu, Option.some(12.3456))
})

it('shows a new worker the entire requested window without fabricating recordings', () => {
	const fresh = series(
		Array.makeBy(21, index => ({...idle, time: index * 30_000})),
		SERIES[10_080]
	)
	assert.lengthOf(history(fresh, 10_080, 600_000), 1)
	assert.strictEqual(Option.getOrThrow(Array.last(history(fresh, 10_080, 600_000))).time, 600_000)
	// A point covers the time from its first measurement.
	assert.strictEqual(history(fresh, 10_080, 600_000)[0]?.since, 0)
	assert.deepStrictEqual(chartWindow(10_080, 600_000), {end: 10_080_000, start: 10_080_000 - 168 * 3_600_000})
	assert.deepStrictEqual(chartWindow(60, 3_600_000), {end: 3_600_000, start: 0})
	assert.deepStrictEqual(chartWindow(60, 7_200_000), {end: 7_200_000, start: 3_600_000})
})

it('does not introduce interior gaps when sleeping-worker history is read again on a later clock-aligned grid', () => {
	const now = 168 * 3_600_000
	const week = Array.makeBy(20_161, index => ({...idle, time: index * 30_000}))
	for (const range of [1440, 10_080] as const) {
		const cached = history(series(week, SERIES[range]), range, now)
		for (const minutes of [5, 10, 17, 23, 100, 140]) {
			const later = now + minutes * 60_000
			const slots = Array.map(
				history(cached, range, later),
				point => Math.ceil((point.time - chartWindow(range, later).start) / resolution(range)) - 1
			)
			assert.isTrue(Array.every(slots, (slot, index) => index === 0 || slot === (slots[index - 1] ?? 0) + 1))
		}
	}
})

function second(index: number) {
	return {
		...idle,
		apps: Option.some([{cpu: 0, id: 'service:user:t3code.service', memory: 1000}]),
		cpu: Option.some(10),
		time: 10_000 + index * 1000
	}
}

it('averages a bucket as its seconds join it, so a short spike still counts', () => {
	const seconds = [
		{
			...second(0),
			apps: Option.some([{cpu: 80, id: 'service:user:t3code.service', memory: 1000}]),
			cpu: Option.some(50)
		},
		second(1),
		second(2),
		{...second(3), apps: Option.some([])},
		...Array.makeBy(16, index => second(index + 4))
	]
	// The first ten seconds are one bucket of the ten-second series; the next ten are another.
	const merged = series(seconds, SERIES[10])
	assert.lengthOf(merged, 2)
	assert.strictEqual(merged[0]?.since, 10_000)
	assert.strictEqual(merged[0]?.time, 19_000)
	assert.closeTo(Option.getOrThrow(merged[0]?.cpu ?? Option.none()), 14, 1e-9)
	// The app missing from the fourth second used nothing then.
	assert.deepStrictEqual(merged[0]?.apps, Option.some([{cpu: 8, id: 'service:user:t3code.service', memory: 900}]))
	assert.deepStrictEqual(merged[1]?.cpu, Option.some(10))
	assert.lengthOf(series(seconds, SERIES[1]), 20)
	// A minute's slot of an hour's chart averages its seconds too.
	assert.closeTo(Option.getOrThrow(history(series(seconds, SERIES[1]), 60, 19_000)[0]?.cpu ?? Option.none()), 14, 1e-9)
})

it('weights each point by the time it covers, across a clock jump and a slot where spacings meet', () => {
	// Ten idle seconds, then ten busy ones already merged into one point, all in one minute that a sleep left behind.
	const mixed = [
		...Array.makeBy(10, index => ({
			...idle,
			cpu: Option.some(0),
			since: (index + 1) * 1000,
			step: 1000,
			time: (index + 1) * 1000
		})),
		{...idle, cpu: Option.some(100), since: 11_000, step: 1000, time: 20_000}
	]
	assert.deepStrictEqual(history(mixed, 60, 20_000)[0]?.cpu, Option.some(50))
	// Disk use is averaged over its bucket like the other readings.
	const disk = history(
		[
			{...idle, since: 1000, step: 1000, storageUsed: Option.some(0), time: 1000},
			{...idle, since: 2000, step: 1000, storageUsed: Option.some(100), time: 2000}
		],
		60,
		2000
	)
	assert.deepStrictEqual(disk[0]?.storageUsed, Option.some(50))
})

it("reads apps from their own cgroups: services, containers and the slice a user's service starts its children in", () => {
	const manager = '/user.slice/user-1000.slice/user@1000.service'
	const apps = ['app-t3code.slice', 't3code.service', 'app-foo.slice', 'foo@1.service']
	assert.isTrue(appCgroup(`${manager}/app.slice/t3code.service`, apps))
	assert.isTrue(appCgroup(`${manager}/app.slice/app-t3code.slice`, apps))
	assert.isTrue(appCgroup('/system.slice/docker-abcdef123456789.scope', []))
	assert.isTrue(appCgroup('/system.slice/tailscaled.service', []))
	assert.isFalse(appCgroup(manager, []))
	// A template's instances share `app-foo.slice` with no `foo.service` beside it, so the walk goes on into it.
	assert.isFalse(appCgroup(`${manager}/app.slice/app-foo.slice`, apps))
	assert.isFalse(
		appCgroup(`${manager}/app.slice/app-t3code.slice/app-t3code-agents.slice`, ['app-t3code-agents.slice'])
	)
	assert.isFalse(appCgroup(`${manager}/app.slice/app-org.chromium.Chromium-1.scope`, apps))
	assert.isFalse(appCgroup('/system.slice/app-other.slice', ['other.service']))
})

it('excludes file cache and reclaimable slab from cgroup memory', () => {
	assert.deepStrictEqual(
		cgroupUsage(
			'usage_usec 5000000\nuser_usec 4000000\n',
			'anon 3000000\nfile 9000000\nkernel 2000000\nshmem 1000000\nslab_reclaimable 1500000\n'
		),
		Option.some({memory: 4_500_000, usage: 5_000_000})
	)
})

it("measures an app's CPU from its cgroups' time as a share of the machine, each cgroup apart, and leaves gaps unmeasured", () => {
	const service = '/app.slice/a.service'
	const slice = '/app.slice/app-a.slice'
	const previous = {
		cgroups: {
			[service]: {id: 'service:user:a.service', memory: 1024 ** 2, usage: 1_000_000},
			[slice]: {id: 'service:user:a.service', memory: 1024 ** 2, usage: 500_000}
		},
		time: 0,
		total: 1000
	}
	const current = {
		cgroups: {
			[service]: {id: 'service:user:a.service', memory: 1024 ** 2 + 100, usage: 2_000_000},
			[slice]: {id: 'service:user:a.service', memory: 1024 ** 2, usage: 1_500_000}
		},
		time: 1000,
		total: 1800
	}
	// Two seconds of CPU time over the machine's eight seconds of ticks is a quarter of it.
	assert.deepStrictEqual(appShares(current, previous), [{cpu: 25, id: 'service:user:a.service', memory: 2 * 1024 ** 2}])
	assert.deepStrictEqual(appShares(current), [{id: 'service:user:a.service', memory: 2 * 1024 ** 2}])
	assert.isUndefined(appShares({...current, time: 100_000}, previous)[0]?.cpu)
	// The service restarted, so its counter began again: the slice still measures.
	assert.strictEqual(
		appShares(
			{...current, cgroups: {...current.cgroups, [service]: {...current.cgroups[service], usage: 10}}},
			previous
		)[0]?.cpu,
		12.5
	)
	assert.isEmpty(
		appShares({...current, cgroups: {[service]: {id: 'service:user:tiny.service', memory: 1024, usage: 0}}}, previous)
	)
})
