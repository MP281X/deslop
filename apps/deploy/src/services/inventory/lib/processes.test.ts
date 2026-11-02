import {assert, it} from '@effect/vitest'

import {Array, Effect, FileSystem, PlatformError, String, pipe} from 'effect'

import {attachProcesses, processReadings, processes} from '#services/inventory/lib/processes.ts'
import {InventoryItem} from '#services/inventory/schema.ts'

function reading(time: number) {
	return {
		records: [{cgroup: '', process: {memory: time, name: 'node', parent: 1, pid: 42}, start: 100, ticks: time / 4}],
		time,
		total: time + 800
	}
}

it.effect('collects names with spaces, parent/RSS and tolerates an exited process without reading command lines', () =>
	pipe(
		Effect.gen(function* () {
			const collected = yield* processes
			assert.strictEqual(collected.total, 800)
			assert.deepStrictEqual(collected.records, [
				{
					cgroup: '0::/user.slice/scope.service\n',
					process: {memory: 1_048_576, name: 'Web Content', parent: 7, pid: 42},
					start: 100,
					ticks: 10
				},
				{
					cgroup: '0::/user.slice/scope.service\n',
					process: {memory: 0, name: 'worker', parent: 1, pid: 7},
					start: 100,
					ticks: 10
				}
			])
		}),
		Effect.provideService(
			FileSystem.FileSystem,
			FileSystem.makeNoop({
				readDirectory: () => Effect.succeed(['42', '7', '99', 'self']),
				readFileString: Effect.fnUntraced(function* (path) {
					if (path === '/proc/stat') return 'cpu 100 0 100 600 0 0 0 0\n'
					if (path === '/proc/42/stat' || path === '/proc/7/stat') {
						return `${path} (Web Content) S 0 0 0 0 0 0 0 0 0 0 10 0 0 0 0 0 0 0 100`
					}
					if (String.endsWith('/cgroup')(path)) return '0::/user.slice/scope.service\n'
					if (path === '/proc/42/status') return 'Name:\tWeb Content\nPid:\t42\nPPid:\t7\nVmRSS:\t1024 kB\n'
					if (path === '/proc/7/status') return 'Name:\tworker\nPid:\t7\nPPid:\t1\n'
					return yield* PlatformError.badArgument({
						description: 'Process exited',
						method: 'readFileString',
						module: 'fixture'
					})
				})
			})
		)
	)
)

it('measures CPU as a share of machine capacity without reusing a PID or bridging counter resets and idle gaps', () => {
	const previous = {
		records: [{cgroup: '', process: {memory: 1024, name: 'node', parent: 1, pid: 42}, start: 100, ticks: 10}],
		time: 0,
		total: 800
	}
	const current = {
		...previous,
		records: Array.map(previous.records, record => ({...record, ticks: 60})),
		time: 10_000,
		total: 1000
	}
	const baseline = processReadings(previous)
	assert.strictEqual(processReadings(current, baseline).readings[0]?.process.cpu, 25)
	assert.isUndefined(processReadings(current).readings[0]?.process.cpu)
	assert.isUndefined(processReadings({...current, time: 100}, baseline).readings[0]?.process.cpu)
	assert.isUndefined(processReadings({...current, time: 31_000}, baseline).readings[0]?.process.cpu)
	assert.isUndefined(processReadings({...current, total: 100}, baseline).readings[0]?.process.cpu)
	assert.isUndefined(
		processReadings({...current, records: Array.map(current.records, record => ({...record, start: 101}))}, baseline)
			.readings[0]?.process.cpu
	)
})

it('shares meaningful CPU deltas between staggered viewers without returning stale memory or reused-PID CPU', () => {
	const first = processReadings(reading(0))
	const early = processReadings(reading(1000), first)
	assert.isUndefined(early.readings[0]?.process.cpu)
	assert.strictEqual(early.baseline.time, 0)
	const viewerA = processReadings(reading(5000), early)
	const viewerB = processReadings(reading(6000), viewerA)
	assert.strictEqual(viewerA.readings[0]?.process.cpu, 25)
	assert.strictEqual(viewerB.readings[0]?.process.cpu, 25)
	assert.strictEqual(viewerB.readings[0]?.process.memory, 6000)
	assert.strictEqual(viewerB.baseline.time, 5000)
	assert.isUndefined(
		processReadings(
			{...reading(6500), records: Array.map(reading(6500).records, record => ({...record, start: 101}))},
			viewerB
		).readings[0]?.process.cpu
	)
	assert.strictEqual(processReadings(reading(10_000), viewerB).readings[0]?.process.cpu, 25)
})

it('attaches only the exact service cgroup in the right scope, or the actual Docker container', () => {
	const item = InventoryItem.make({
		detail: '',
		id: 'dev:user:scope.service',
		kind: 'service',
		name: 'scope.service',
		scope: 'user',
		state: 'running',
		url: '',
		worker: 'dev'
	})
	const process = {memory: 1024, name: 'node', parent: 7, pid: 42}
	const rows = [{cgroup: '0::/user.slice/user-1000.slice/user@1000.service/app.slice/scope.service\n', process}]
	assert.deepStrictEqual(attachProcesses([item], rows)[0]?.processes, [process])
	assert.isEmpty(attachProcesses([{...item, scope: 'system'}], rows)[0]?.processes ?? [])
	assert.isEmpty(
		attachProcesses([item], [{...rows[0], cgroup: '0::/user.slice/scope.service-other\n', process}])[0]?.processes ?? []
	)
	assert.deepStrictEqual(
		attachProcesses(
			[{...item, id: 'dev:docker:abcdef123456', kind: 'container'}],
			[{cgroup: '0::/system.slice/docker-abcdef123456789.scope\n', process}]
		)[0]?.processes,
		[process]
	)
	assert.deepStrictEqual(
		attachProcesses(
			[{...item, name: 'user@1000.service', scope: 'system'}],
			[{cgroup: '0::/user.slice/user-1000.slice/user@1000.service/init.scope\n', process}]
		)[0]?.processes,
		[process]
	)
	assert.isEmpty(attachProcesses([{...item, name: 'user@1000.service', scope: 'system'}], rows)[0]?.processes ?? [])
})
