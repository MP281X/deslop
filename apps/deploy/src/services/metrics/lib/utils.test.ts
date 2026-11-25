import {assert, it} from '@effect/vitest'

import {Array, Boolean, DateTime, Duration, Option, pipe} from 'effect'

import {AppId} from '#services/inventory/schema.ts'
import {
	appCgroup,
	appShares,
	cgroupUsage,
	counters,
	expired,
	history,
	linuxDisks,
	rollup,
	sample
} from '#services/metrics/lib/utils.ts'
import {CgroupPath} from '#services/metrics/schema.ts'
import type {Sample} from '#services/metrics/schema.ts'

const POINT = {
	apps: Option.none(),
	appsCoverage: Duration.zero,
	cpu: Option.none<number>(),
	cpuCoverage: Duration.zero,
	memoryCoverage: Duration.seconds(1),
	memoryTotal: 1024,
	memoryUsed: 768,
	storageCoverage: Duration.seconds(1),
	storageUsed: Option.some(750),
	time: DateTime.makeUnsafe(0)
}
const APP = AppId.make('service:user:app.service')

it('measures CPU deltas and leaves resets and gaps unmeasured', () => {
	const previous = counters('cpu 100 0 100 600 0 0 0 0', '100 0', DateTime.makeUnsafe(30_000))
	const current = {
		...previous,
		cpuIdle: Duration.millis(7000),
		cpuTotal: Duration.millis(10_000),
		time: DateTime.makeUnsafe(60_000),
		uptime: Duration.seconds(130)
	}
	assert.deepStrictEqual(
		sample(current, 'MemTotal: 1024 kB\nMemAvailable: 256 kB', [], Option.some(previous), Option.none()).point.cpu,
		Option.some(50)
	)
	assert.deepStrictEqual(
		sample(
			{...current, uptime: Duration.seconds(1)},
			'MemTotal: 1024 kB\nMemAvailable: 256 kB',
			[],
			Option.some(previous),
			Option.none()
		).point.cpu,
		Option.none()
	)
	assert.deepStrictEqual(
		sample(
			{...current, time: DateTime.makeUnsafe(150_001)},
			'MemTotal: 1024 kB\nMemAvailable: 256 kB',
			[],
			Option.some(previous),
			Option.none()
		).point.cpu,
		Option.none()
	)
})

it('reads each range from plain samples and keeps missing readings unmeasured', () => {
	const points = [
		{...POINT, since: DateTime.makeUnsafe(1000), step: Duration.minutes(1), time: DateTime.makeUnsafe(1000)},
		{
			...POINT,
			cpu: Option.some(20),
			cpuCoverage: Duration.seconds(1),
			since: DateTime.makeUnsafe(61_000),
			step: Duration.minutes(1),
			time: DateTime.makeUnsafe(61_000)
		}
	]
	assert.deepStrictEqual(
		Array.map(history(points, Duration.minutes(60), DateTime.makeUnsafe(61_000)), point => point.cpu),
		[Option.none(), Option.some(20)]
	)
	assert.isEmpty(history(points, Duration.minutes(1), DateTime.makeUnsafe(180_000)))
})

it('weights an existing rollup by its coverage and counts missing apps as zero', () => {
	const stored = [
		{
			...POINT,
			apps: Option.some([{cpu: Option.some(80), cpuCoverage: Duration.seconds(9), id: APP, memory: 1000}]),
			appsCoverage: Duration.seconds(9),
			cpu: Option.some(50),
			cpuCoverage: Duration.seconds(9),
			memoryCoverage: Duration.seconds(9),
			since: DateTime.makeUnsafe(10_000),
			step: Duration.seconds(10),
			time: DateTime.makeUnsafe(18_000)
		}
	]
	const rolled = rollup(
		{
			...POINT,
			apps: Option.some([]),
			appsCoverage: Duration.seconds(1),
			cpu: Option.some(10),
			cpuCoverage: Duration.seconds(1),
			time: DateTime.makeUnsafe(19_000)
		},
		stored
	)
	assert.deepStrictEqual(
		Array.map(rolled, point => Duration.toMillis(point.step)),
		[10_000, 60_000, 900_000, 3_600_000, 21_600_000]
	)
	const merged = Option.getOrThrow(Array.findFirst(rolled, point => Duration.equals(point.step, Duration.seconds(10))))
	assert.deepStrictEqual(
		[merged.cpu, Option.map(merged.apps, apps => Array.map(apps, app => [app.cpu, app.memory]))],
		[Option.some(46), Option.some([[Option.some(72), 900]])]
	)
})

it('weights an already averaged sample by the time it measured, not the time it spans', () => {
	assert.deepStrictEqual(
		history(
			[
				{
					...POINT,
					cpu: Option.some(0),
					cpuCoverage: Duration.seconds(5),
					since: DateTime.makeUnsafe(1000),
					step: Duration.minutes(1),
					time: DateTime.makeUnsafe(10_000)
				},
				{
					...POINT,
					cpu: Option.some(100),
					cpuCoverage: Duration.seconds(5),
					since: DateTime.makeUnsafe(11_000),
					step: Duration.minutes(1),
					time: DateTime.makeUnsafe(20_000)
				}
			],
			Duration.minutes(60),
			DateTime.makeUnsafe(20_000)
		)[0]?.cpu,
		Option.some(50)
	)
})

it('reads service cgroups while leaving nested app slices to their owning group', () => {
	assert.isTrue(
		appCgroup('/user.slice/user-1000.slice/user@1000.service/app.slice/app-t3code.slice', [
			'app-t3code.slice',
			't3code.service'
		])
	)
	assert.isFalse(
		appCgroup('/user.slice/user-1000.slice/user@1000.service/app.slice/app-t3code.slice/app-t3code-agents.slice', [
			'app-t3code-agents.slice'
		])
	)
	assert.isTrue(appCgroup('/system.slice/docker-abcdef123456789.scope', []))
})

it('excludes reclaimable cache from reported cgroup memory', () => {
	assert.deepStrictEqual(
		cgroupUsage(
			'usage_usec 5000000\n',
			'anon 3000000\nfile 9000000\nkernel 2000000\nshmem 1000000\nslab_reclaimable 1500000\n'
		),
		Option.some({memory: 4_500_000, usage: Duration.millis(5000)})
	)
})

it('combines CPU deltas of an app across its service and child slice', () => {
	const service = CgroupPath.make('/app.slice/a.service')
	const slice = CgroupPath.make('/app.slice/app-a.slice')
	const previous = {
		cgroups: {
			[service]: {id: APP, memory: 1_048_576, usage: Duration.millis(1000)},
			[slice]: {id: APP, memory: 1_048_576, usage: Duration.millis(500)}
		},
		time: DateTime.makeUnsafe(0),
		total: Duration.millis(10_000)
	}
	const current = {
		cgroups: {
			[service]: {id: APP, memory: 2_097_152, usage: Duration.millis(2000)},
			[slice]: {id: APP, memory: 1_048_576, usage: Duration.millis(1500)}
		},
		time: DateTime.makeUnsafe(1000),
		total: Duration.millis(18_000)
	}
	assert.deepStrictEqual(
		Array.map(appShares(current, Option.some(previous)), app => [app.cpu, app.memory]),
		[[Option.some(25), 3_145_728]]
	)
	assert.deepStrictEqual(
		appShares({...current, time: DateTime.makeUnsafe(100_000)}, Option.some(previous))[0]?.cpu,
		Option.none()
	)
})

it('averages apps over the seconds that measured them, an empty measurement counting as nothing used', () => {
	const rolled = Array.reduce(Array.range(0, 4), Array.empty<Sample>(), (stored, second) =>
		rollup(
			{
				...POINT,
				apps: Option.some(
					Boolean.match(second === 0, {onFalse: () => [], onTrue: () => [{cpu: Option.none(), id: APP, memory: 100}]})
				),
				appsCoverage: Duration.seconds(1),
				time: DateTime.makeUnsafe(second * 1000)
			},
			stored
		)
	)
	assert.deepStrictEqual(
		pipe(
			Array.head(rolled),
			Option.flatMap(point => point.apps),
			Option.map(Array.map(app => app.memory))
		),
		Option.some([20])
	)
})

function rollApp(readings: readonly {cpu: Option.Option<number>; second: number}[]) {
	return Array.reduce(readings, Array.empty<Sample>(), (stored, reading) =>
		rollup(
			{
				...POINT,
				apps: Option.some([{cpu: reading.cpu, id: APP, memory: 100}]),
				appsCoverage: Duration.seconds(1),
				time: DateTime.makeUnsafe(reading.second * 1000)
			},
			stored
		)
	)
}

function appCpu(rolled: readonly Sample[]) {
	return pipe(
		Array.head(rolled),
		Option.flatMap(point => point.apps),
		Option.flatMap(Array.head),
		Option.flatMap(app => app.cpu)
	)
}

it('averages an app’s CPU over the time it was read, however long it was running', () => {
	// An app's first second has no CPU to difference: the next two average 80 and 20, not 60.
	assert.deepStrictEqual(
		appCpu(
			rollApp([
				{cpu: Option.none(), second: 0},
				{cpu: Option.some(80), second: 1},
				{cpu: Option.some(20), second: 2}
			])
		),
		Option.some(50)
	)
	// Seconds between the readings went unread: each reading still weighs one second.
	assert.deepStrictEqual(
		appCpu(
			rollApp([
				{cpu: Option.some(10), second: 0},
				{cpu: Option.some(20), second: 5},
				{cpu: Option.some(90), second: 6}
			])
		),
		Option.some(40)
	)
})

it('reads a mount point with spaces from df and refuses a row without its numbers', () => {
	assert.deepStrictEqual(linuxDisks('Mounted on 1B-blocks Used\n/ 2048 1024\n/mnt/Team Café  4096 512\n'), [
		{mount: '/', total: 2048, used: 1024},
		{mount: '/mnt/Team Café', total: 4096, used: 512}
	])
	assert.throws(() => {
		linuxDisks('Mounted on 1B-blocks Used\n/mnt/broken -\n')
	})
})

it('keeps a buffered point while its range still shows it', () => {
	const point = {...POINT, since: DateTime.makeUnsafe(0), step: Duration.seconds(10)}
	assert.isFalse(expired(point, DateTime.makeUnsafe(610_000)))
	assert.isTrue(expired(point, DateTime.makeUnsafe(610_001)))
})
