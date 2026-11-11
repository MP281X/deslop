import {assert, it} from '@effect/vitest'

import {Array, HashSet, Option} from 'effect'

import {
	appCgroup,
	appShares,
	cgroupUsage,
	chartWindow,
	compact,
	counters,
	history,
	resolution,
	sample
} from '#services/metrics/lib/utils.ts'

const MEMORY = 'MemTotal: 1024 kB\nMemAvailable: 256 kB'
const STORAGE = 'Mounted on 1B-blocks Used\n/ 1000000 750000'

it('measures CPU deltas and leaves reset or gap readings absent', () => {
	const first = counters('cpu 100 0 100 600 0 0 0 0 999 999', '100 0', 30_000)
	assert.strictEqual(first.cpuTotal, 800)
	const current = {...first, cpuIdle: 700, cpuTotal: 1000, time: 60_000, uptime: 130}
	const value = sample(current, MEMORY, STORAGE, first)
	assert.strictEqual(value.cpu, 50)
	assert.strictEqual(value.memoryUsed, 768 * 1024)
	assert.strictEqual(value.storageUsed, 750_000)
	assert.deepStrictEqual(value.disks, [{mount: '/', total: 1_000_000, used: 750_000}])
	assert.isUndefined(sample(current, MEMORY, '').storageUsed)
	assert.isUndefined(sample(current, MEMORY, STORAGE).cpu)
	assert.isUndefined(sample({...current, uptime: 1}, MEMORY, STORAGE, first).cpu)
	assert.isUndefined(sample({...current, time: 150_001}, MEMORY, STORAGE, first).cpu)
})

it('bounds history by the chosen time window and response size without synthesizing measurements', () => {
	const value = sample(counters('cpu 100 0 100 600 0 0 0 0', '100 0', 0), MEMORY, STORAGE)
	const samples = Array.makeBy(20_161, index => ({...value, time: index * 30_000}))
	const now = 168 * 3_600_000
	const selected = history(samples, 60, now)
	assert.lengthOf(selected, 60)
	assert.lengthOf(history(samples, 1440, now), 60)
	assert.lengthOf(history(samples, 10_080, now), 60)
	assert.strictEqual(Option.getOrThrow(Array.last(selected)).time, now)
	assert.strictEqual(history(samples, 10_080, now)[0]?.since, 30_000)
	assert.isEmpty(history(samples, 60, now + 2 * 3_600_000))
	const retained = compact(samples, now)
	assert.isBelow(retained.length, 400)
	const times = HashSet.fromIterable(Array.map(samples, point => point.time))
	assert.isTrue(Array.every(retained, point => HashSet.has(times, point.time)))
	assert.deepStrictEqual(compact(retained, now), retained)
})

it('measures individual logical cores, load and uptime without bridging resets', () => {
	const first = counters('cpu 100 0 100 600 0 0 0 0\ncpu0 100 0 100 600 0 0 0 0', '100 0', 0)
	const current = counters(
		'cpu 150 0 150 700 0 0 0 0\ncpu0 150 0 150 700 0 0 0 0\ncpu1 10 0 10 20 0 0 0 0',
		'130 0',
		30_000
	)
	const value = sample(current, MEMORY, STORAGE, first, '1.5 2.5 3.5 1/20 123')
	assert.deepStrictEqual(value.cores, [{id: 'cpu0', usage: 50}, {id: 'cpu1'}])
	assert.deepStrictEqual(value.load, [1.5, 2.5, 3.5])
	assert.strictEqual(value.uptime, 130)
	assert.isUndefined(sample({...current, uptime: 1}, MEMORY, STORAGE, first).cores?.[0]?.usage)
	assert.isUndefined(sample({...current, time: 100_000}, MEMORY, STORAGE, first).cores?.[0]?.usage)
	assert.isUndefined(
		sample({...current, cores: [{id: 'cpu0', idle: 1, total: 1000}]}, MEMORY, STORAGE, first).cores?.[0]?.usage
	)
})

it('keeps mounts on the newest point and a missing reading unmeasured', () => {
	const value = sample(counters('cpu 100 0 100 600 0 0 0 0', '100 0', 0), MEMORY, STORAGE)
	const selected = history([value, {...value, cpu: 12.3456, time: 60_000}], 60, 60_000)
	assert.isEmpty(selected[0]?.disks ?? [])
	assert.strictEqual(selected[0]?.storageUsed, 750_000)
	assert.isUndefined(selected[0]?.cpu)
	assert.strictEqual(selected[1]?.cpu, 12.3456)
	assert.deepStrictEqual(selected[1]?.disks, value.disks)
})

it('retains new-agent samples while displaying the entire requested window without fabricating recordings', () => {
	const value = sample(counters('cpu 100 0 100 600 0 0 0 0', '100 0', 0), MEMORY, STORAGE)
	const fresh = Array.makeBy(21, index => ({...value, time: index * 30_000}))
	assert.lengthOf(history(fresh, 10_080, 600_000), 2)
	assert.strictEqual(Option.getOrThrow(Array.last(history(fresh, 10_080, 600_000))).time, 600_000)
	// A slot of one sample was recorded from that sample's own time.
	assert.strictEqual(history(fresh, 10_080, 600_000)[0]?.time, 0)
	assert.isUndefined(history(fresh, 10_080, 600_000)[0]?.since)
	assert.deepStrictEqual(chartWindow(10_080, 600_000), {end: 10_080_000, start: 10_080_000 - 168 * 3_600_000})
	assert.deepStrictEqual(chartWindow(60, 3_600_000), {end: 3_600_000, start: 0})
	assert.deepStrictEqual(chartWindow(60, 7_200_000), {end: 7_200_000, start: 3_600_000})
})

it('does not introduce interior gaps when sleeping-worker history is read again on a later clock-aligned grid', () => {
	const value = sample(counters('cpu 100 0 100 600 0 0 0 0', '100 0', 0), MEMORY, STORAGE)
	const now = 168 * 3_600_000
	const retained = compact(
		Array.makeBy(20_161, index => ({...value, time: index * 30_000})),
		now
	)
	for (const range of [1440, 10_080]) {
		const cached = history(retained, range, now)
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

it('averages a merged bucket so a short spike still counts, and merges each bucket once, complete', () => {
	const value = sample(counters('cpu 100 0 100 600 0 0 0 0', '100 0', 0), MEMORY, STORAGE)
	function second(index: number) {
		return {
			...value,
			apps: [{cpu: 0, id: 'service:user:t3code.service', memory: 1000}],
			cores: [{id: 'cpu0', usage: 0}],
			cpu: 10,
			time: 10_000 + index * 1000
		}
	}
	const seconds = [
		{
			...second(0),
			apps: [{cpu: 80, id: 'service:user:t3code.service', memory: 1000}],
			cores: [{id: 'cpu0', usage: 100}],
			cpu: 50
		},
		second(1),
		second(2),
		{...second(3), apps: []},
		...Array.makeBy(16, index => second(index + 4))
	]
	// 70 seconds on, the first ten seconds are past the minute of second samples and merge; the next ten are still whole seconds.
	const merged = compact(seconds, 81_000)
	assert.lengthOf(merged, 11)
	assert.strictEqual(merged[0]?.time, 19_000)
	assert.strictEqual(merged[0]?.since, 10_000)
	assert.strictEqual(merged[0]?.cpu, 14)
	assert.deepStrictEqual(merged[0]?.cores, [{id: 'cpu0', usage: 10}])
	// The app missing from the fourth second used nothing then.
	assert.deepStrictEqual(merged[0]?.apps, [{cpu: 8, id: 'service:user:t3code.service', memory: 900}])
	assert.deepStrictEqual(merged[1], seconds[10])
	assert.deepStrictEqual(compact(merged, 81_000), merged)
	// A minute's slot of an hour's chart averages its seconds too.
	assert.strictEqual(history(seconds, 60, 19_000)[0]?.cpu, 14)
})

it('weights each sample by the time it covers, across a clock jump and a slot where spacings meet', () => {
	const value = sample(counters('cpu 100 0 100 600 0 0 0 0', '100 0', 0), MEMORY, STORAGE)
	// Ten idle seconds, then ten busy ones already merged into one sample, all in one minute that a sleep left behind.
	const mixed = [
		...Array.makeBy(10, index => ({...value, cpu: 0, time: (index + 1) * 1000})),
		{...value, cpu: 100, since: 11_000, time: 20_000}
	]
	assert.strictEqual(compact(mixed, 700_000)[0]?.cpu, 50)
	assert.strictEqual(history(mixed, 60, 20_000)[0]?.cpu, 50)
	// Disk use is averaged over its bucket like the other readings.
	const disk = history(
		[
			{...value, storageUsed: 0, time: 1000},
			{...value, storageUsed: 100, time: 2000}
		],
		60,
		2000
	)
	assert.strictEqual(disk[0]?.storageUsed, 50)
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
